use anchor_lang::prelude::*;
use anchor_lang::solana_program::{program::invoke, program::invoke_signed, system_instruction};
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("BxXchZ6JkP4ybA74BfA1itf7fGv6XqFtwnwSDX6JaCsj");

const SCALE: u128 = 1_000_000_000_000;

#[program]
pub mod pete_staking {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.pete_mint = ctx.accounts.pete_mint.key();
        config.stake_vault = ctx.accounts.stake_vault.key();
        config.reward_vault = ctx.accounts.reward_vault.key();
        config.bump = ctx.bumps.config;
        config.stake_vault_bump = ctx.bumps.stake_vault;
        config.reward_vault_bump = ctx.bumps.reward_vault;
        config.token_decimals = ctx.accounts.pete_mint.decimals;
        config.paused = false;
        config.total_staked = 0;
        config.reward_per_token_accumulated = 0;
        config.allocated_unclaimed_lamports = 0;
        config.unallocated_rewards_lamports = 0;
        config.total_funded_lamports = 0;
        config.total_claimed_lamports = 0;
        Ok(())
    }

    pub fn stake(ctx: Context<Stake>, amount: u64) -> Result<()> {
        require!(!ctx.accounts.config.paused, PeteError::Paused);
        require!(amount > 0, PeteError::InvalidAmount);

        init_position_if_needed(&mut ctx.accounts.position, &ctx.accounts.user, ctx.bumps.position)?;
        require_keys_eq!(ctx.accounts.position.owner, ctx.accounts.user.key(), PeteError::InvalidOwner);

        settle_position(&ctx.accounts.config, &mut ctx.accounts.position)?;

        let cpi_accounts = Transfer {
            from: ctx.accounts.user_token_account.to_account_info(),
            to: ctx.accounts.stake_vault.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        token::transfer(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts),
            amount,
        )?;

        ctx.accounts.position.amount_staked = ctx
            .accounts
            .position
            .amount_staked
            .checked_add(amount)
            .ok_or(PeteError::MathOverflow)?;
        ctx.accounts.config.total_staked = ctx
            .accounts
            .config
            .total_staked
            .checked_add(amount)
            .ok_or(PeteError::MathOverflow)?;
        ctx.accounts.position.reward_debt = ctx.accounts.config.reward_per_token_accumulated;
        Ok(())
    }

    pub fn unstake(ctx: Context<Unstake>, amount: u64) -> Result<()> {
        require!(!ctx.accounts.config.paused, PeteError::Paused);
        require!(amount > 0, PeteError::InvalidAmount);
        require_keys_eq!(ctx.accounts.position.owner, ctx.accounts.user.key(), PeteError::InvalidOwner);
        require!(ctx.accounts.position.amount_staked >= amount, PeteError::InsufficientStake);

        settle_position(&ctx.accounts.config, &mut ctx.accounts.position)?;

        ctx.accounts.position.amount_staked = ctx
            .accounts
            .position
            .amount_staked
            .checked_sub(amount)
            .ok_or(PeteError::MathOverflow)?;
        ctx.accounts.config.total_staked = ctx
            .accounts
            .config
            .total_staked
            .checked_sub(amount)
            .ok_or(PeteError::MathOverflow)?;
        ctx.accounts.position.reward_debt = ctx.accounts.config.reward_per_token_accumulated;

        let signer_seeds: &[&[&[u8]]] = &[&[b"config", &[ctx.accounts.config.bump]]];
        let cpi_accounts = Transfer {
            from: ctx.accounts.stake_vault.to_account_info(),
            to: ctx.accounts.user_token_account.to_account_info(),
            authority: ctx.accounts.config.to_account_info(),
        };
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                cpi_accounts,
                signer_seeds,
            ),
            amount,
        )?;
        Ok(())
    }

    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        require!(!ctx.accounts.config.paused, PeteError::Paused);
        require_keys_eq!(ctx.accounts.position.owner, ctx.accounts.user.key(), PeteError::InvalidOwner);

        settle_position(&ctx.accounts.config, &mut ctx.accounts.position)?;
        let amount = ctx.accounts.position.pending_rewards_lamports;
        require!(amount > 0, PeteError::NothingToClaim);
        require!(
            ctx.accounts.config.allocated_unclaimed_lamports >= amount,
            PeteError::MathOverflow
        );
        require!(
            ctx.accounts.reward_vault.lamports() >= amount,
            PeteError::InsufficientRewards
        );

        ctx.accounts.position.pending_rewards_lamports = 0;
        ctx.accounts.config.allocated_unclaimed_lamports = ctx
            .accounts
            .config
            .allocated_unclaimed_lamports
            .checked_sub(amount)
            .ok_or(PeteError::MathOverflow)?;
        ctx.accounts.config.total_claimed_lamports = ctx
            .accounts
            .config
            .total_claimed_lamports
            .checked_add(amount)
            .ok_or(PeteError::MathOverflow)?;

        let ix = system_instruction::transfer(
            &ctx.accounts.reward_vault.key(),
            &ctx.accounts.user.key(),
            amount,
        );
        invoke_signed(
            &ix,
            &[
                ctx.accounts.reward_vault.to_account_info(),
                ctx.accounts.user.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            &[&[b"reward_vault", &[ctx.accounts.config.reward_vault_bump]]],
        )?;
        Ok(())
    }

    pub fn fund_rewards(ctx: Context<FundRewards>, amount: u64) -> Result<()> {
        require!(amount > 0, PeteError::InvalidAmount);

        let ix = system_instruction::transfer(
            &ctx.accounts.funder.key(),
            &ctx.accounts.reward_vault.key(),
            amount,
        );
        invoke(
            &ix,
            &[
                ctx.accounts.funder.to_account_info(),
                ctx.accounts.reward_vault.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        ctx.accounts.config.total_funded_lamports = ctx
            .accounts
            .config
            .total_funded_lamports
            .checked_add(amount)
            .ok_or(PeteError::MathOverflow)?;

        if ctx.accounts.config.total_staked == 0 {
            ctx.accounts.config.unallocated_rewards_lamports = ctx
                .accounts
                .config
                .unallocated_rewards_lamports
                .checked_add(amount)
                .ok_or(PeteError::MathOverflow)?;
            return Ok(());
        }

        let distributable = ctx
            .accounts
            .config
            .unallocated_rewards_lamports
            .checked_add(amount)
            .ok_or(PeteError::MathOverflow)?;
        let increment = (distributable as u128)
            .checked_mul(SCALE)
            .ok_or(PeteError::MathOverflow)?
            .checked_div(ctx.accounts.config.total_staked as u128)
            .ok_or(PeteError::MathOverflow)?;

        if increment == 0 {
            ctx.accounts.config.unallocated_rewards_lamports = distributable;
            return Ok(());
        }

        let distributed = increment
            .checked_mul(ctx.accounts.config.total_staked as u128)
            .ok_or(PeteError::MathOverflow)?
            .checked_div(SCALE)
            .ok_or(PeteError::MathOverflow)?;
        let distributed_u64 = u64::try_from(distributed).map_err(|_| PeteError::MathOverflow)?;

        ctx.accounts.config.reward_per_token_accumulated = ctx
            .accounts
            .config
            .reward_per_token_accumulated
            .checked_add(increment)
            .ok_or(PeteError::MathOverflow)?;
        ctx.accounts.config.allocated_unclaimed_lamports = ctx
            .accounts
            .config
            .allocated_unclaimed_lamports
            .checked_add(distributed_u64)
            .ok_or(PeteError::MathOverflow)?;
        ctx.accounts.config.unallocated_rewards_lamports = distributable
            .checked_sub(distributed_u64)
            .ok_or(PeteError::MathOverflow)?;
        Ok(())
    }

    pub fn sweep_unallocated(ctx: Context<SweepUnallocated>, amount: u64) -> Result<()> {
        require_keys_eq!(ctx.accounts.config.admin, ctx.accounts.admin.key(), PeteError::Unauthorized);

        let reserved = ctx
            .accounts
            .config
            .allocated_unclaimed_lamports
            .checked_add(ctx.accounts.config.unallocated_rewards_lamports)
            .ok_or(PeteError::MathOverflow)?;
        let extra = ctx.accounts.reward_vault.lamports().saturating_sub(reserved);
        let sweepable = ctx
            .accounts
            .config
            .unallocated_rewards_lamports
            .checked_add(extra)
            .ok_or(PeteError::MathOverflow)?;
        let requested = if amount == 0 { sweepable } else { amount };

        require!(requested > 0, PeteError::NothingToSweep);
        require!(requested <= sweepable, PeteError::InsufficientRewards);

        let from_unallocated = requested.min(ctx.accounts.config.unallocated_rewards_lamports);
        ctx.accounts.config.unallocated_rewards_lamports = ctx
            .accounts
            .config
            .unallocated_rewards_lamports
            .checked_sub(from_unallocated)
            .ok_or(PeteError::MathOverflow)?;

        let ix = system_instruction::transfer(
            &ctx.accounts.reward_vault.key(),
            &ctx.accounts.destination.key(),
            requested,
        );
        invoke_signed(
            &ix,
            &[
                ctx.accounts.reward_vault.to_account_info(),
                ctx.accounts.destination.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            &[&[b"reward_vault", &[ctx.accounts.config.reward_vault_bump]]],
        )?;
        Ok(())
    }

    pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
        require_keys_eq!(ctx.accounts.config.admin, ctx.accounts.admin.key(), PeteError::Unauthorized);
        ctx.accounts.config.paused = paused;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + Config::INIT_SPACE, seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = admin,
        token::mint = pete_mint,
        token::authority = config,
        seeds = [b"stake_vault"],
        bump
    )]
    pub stake_vault: Account<'info, TokenAccount>,
    /// CHECK: SOL reward PDA. It is system-owned and signs reward transfers with PDA seeds.
    #[account(mut, seeds = [b"reward_vault"], bump)]
    pub reward_vault: UncheckedAccount<'info>,
    pub pete_mint: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Stake<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + Position::INIT_SPACE,
        seeds = [b"position", user.key().as_ref()],
        bump
    )]
    pub position: Account<'info, Position>,
    #[account(address = config.pete_mint)]
    pub pete_mint: Account<'info, Mint>,
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = pete_mint,
        associated_token::authority = user
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(mut, address = config.stake_vault)]
    pub stake_vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Unstake<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"position", user.key().as_ref()], bump = position.bump)]
    pub position: Account<'info, Position>,
    #[account(address = config.pete_mint)]
    pub pete_mint: Account<'info, Mint>,
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = pete_mint,
        associated_token::authority = user
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(mut, address = config.stake_vault)]
    pub stake_vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"position", user.key().as_ref()], bump = position.bump)]
    pub position: Account<'info, Position>,
    /// CHECK: SOL reward PDA. Constraint ties it to config.
    #[account(mut, address = config.reward_vault)]
    pub reward_vault: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FundRewards<'info> {
    #[account(mut)]
    pub funder: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    /// CHECK: SOL reward PDA. Constraint ties it to config.
    #[account(mut, address = config.reward_vault)]
    pub reward_vault: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SweepUnallocated<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    /// CHECK: SOL reward PDA. Constraint ties it to config.
    #[account(mut, address = config.reward_vault)]
    pub reward_vault: UncheckedAccount<'info>,
    /// CHECK: Admin-selected destination for unallocated/stuck SOL.
    #[account(mut)]
    pub destination: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetPaused<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub pete_mint: Pubkey,
    pub stake_vault: Pubkey,
    pub reward_vault: Pubkey,
    pub bump: u8,
    pub stake_vault_bump: u8,
    pub reward_vault_bump: u8,
    pub token_decimals: u8,
    pub paused: bool,
    pub total_staked: u64,
    pub reward_per_token_accumulated: u128,
    pub allocated_unclaimed_lamports: u64,
    pub unallocated_rewards_lamports: u64,
    pub total_funded_lamports: u64,
    pub total_claimed_lamports: u64,
}

#[account]
#[derive(InitSpace)]
pub struct Position {
    pub owner: Pubkey,
    pub amount_staked: u64,
    pub reward_debt: u128,
    pub pending_rewards_lamports: u64,
    pub bump: u8,
}

fn init_position_if_needed(
    position: &mut Account<Position>,
    user: &Signer,
    bump: u8,
) -> Result<()> {
    if position.owner == Pubkey::default() {
        position.owner = user.key();
        position.amount_staked = 0;
        position.reward_debt = 0;
        position.pending_rewards_lamports = 0;
        position.bump = bump;
    }
    Ok(())
}

fn settle_position(config: &Account<Config>, position: &mut Account<Position>) -> Result<()> {
    if position.amount_staked > 0 {
        let delta = config
            .reward_per_token_accumulated
            .checked_sub(position.reward_debt)
            .ok_or(PeteError::MathOverflow)?;
        let accrued = (position.amount_staked as u128)
            .checked_mul(delta)
            .ok_or(PeteError::MathOverflow)?
            .checked_div(SCALE)
            .ok_or(PeteError::MathOverflow)?;
        let accrued_u64 = u64::try_from(accrued).map_err(|_| PeteError::MathOverflow)?;
        position.pending_rewards_lamports = position
            .pending_rewards_lamports
            .checked_add(accrued_u64)
            .ok_or(PeteError::MathOverflow)?;
    }

    position.reward_debt = config.reward_per_token_accumulated;
    Ok(())
}

#[error_code]
pub enum PeteError {
    #[msg("The staking program is paused.")]
    Paused,
    #[msg("Invalid amount.")]
    InvalidAmount,
    #[msg("Math overflow.")]
    MathOverflow,
    #[msg("Invalid stake position owner.")]
    InvalidOwner,
    #[msg("Insufficient staked amount.")]
    InsufficientStake,
    #[msg("Nothing to claim.")]
    NothingToClaim,
    #[msg("Insufficient reward vault balance.")]
    InsufficientRewards,
    #[msg("Unauthorized admin action.")]
    Unauthorized,
    #[msg("Nothing to sweep.")]
    NothingToSweep,
}
