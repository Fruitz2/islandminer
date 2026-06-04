(function () {
  'use strict';

  var REFERENCE_DATE = new Date('2019-08-10T10:30:00Z');

  function pad(n, w) {
    w = w || 2;
    var s = String(n);
    while (s.length < w) s = '0' + s;
    return s;
  }

  var daysEl = document.getElementById('days-counter');
  var precEl = document.getElementById('precision');
  var hasAnimated = false;

  function getElapsed() {
    var now = new Date();
    var ms = now.getTime() - REFERENCE_DATE.getTime();
    if (ms < 0) ms = 0;
    return {
      days: Math.floor(ms / 86400000),
      h: Math.floor((ms % 86400000) / 3600000),
      m: Math.floor((ms % 3600000) / 60000),
      s: Math.floor((ms % 60000) / 1000)
    };
  }

  function renderClock() {
    var e = getElapsed();
    if (precEl) precEl.textContent = pad(e.h) + ':' + pad(e.m) + ':' + pad(e.s);
    if (daysEl && hasAnimated) {
      daysEl.textContent = pad(e.days, 4);
    }
  }

  function countUp() {
    if (!daysEl) { hasAnimated = true; return; }
    var target = getElapsed().days;
    var start = performance.now();
    var duration = 1600;

    function frame(now) {
      var t = Math.min(1, (now - start) / duration);
      var eased = 1 - Math.pow(1 - t, 3);
      var v = Math.floor(eased * target);
      daysEl.textContent = pad(v, 4);
      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        hasAnimated = true;
        daysEl.textContent = pad(target, 4);
      }
    }
    requestAnimationFrame(frame);
  }

  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    hasAnimated = true;
    renderClock();
  } else {
    countUp();
  }

  renderClock();
  setInterval(renderClock, 1000);

  /* AUDIO FAB */
  var fab = document.getElementById('audio-fab');
  var label = fab ? fab.querySelector('.audio-label') : null;
  var audioOn = false;
  var synth = null;
  var noise = null;
  var pulse = null;
  var loopId = null;

  function startAudio() {
    if (typeof Tone === 'undefined') return;
    if (Tone.context.state !== 'running') Tone.context.resume();

    noise = new Tone.Noise('pink').start();
    var noiseFilter = new Tone.Filter({ frequency: 220, type: 'lowpass', rolloff: -24 });
    var noiseGain = new Tone.Gain(0.04).toDestination();
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);

    synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'sine' },
      envelope: { attack: 1.8, decay: 0.4, sustain: 0.6, release: 3.2 }
    });
    var synthFilter = new Tone.Filter({ frequency: 1400, type: 'lowpass' });
    var synthGain = new Tone.Gain(0.05).toDestination();
    synth.connect(synthFilter);
    synthFilter.connect(synthGain);
    synth.triggerAttack(['C2', 'G2', 'D#3']);

    pulse = new Tone.MembraneSynth({
      pitchDecay: 0.02,
      octaves: 2,
      envelope: { attack: 0.001, decay: 0.18, sustain: 0, release: 0.08 }
    });
    var pulseGain = new Tone.Gain(0.05).toDestination();
    pulse.connect(pulseGain);

    var i = 0;
    var pattern = [['C1', 1.4], ['C1', 0.9], ['G0', 0.7], ['C1', 1.1]];

    loopId = setInterval(function () {
      if (!audioOn) return;
      var note = pattern[i % pattern.length];
      try { pulse.triggerAttackRelease(note[0], '32n'); } catch (e) {}
      i++;
    }, 1500);

    audioOn = true;
    if (fab) fab.classList.add('on');
    if (label) label.textContent = 'FEED ACTIVE';
  }

  function stopAudio() {
    audioOn = false;
    if (loopId) { clearInterval(loopId); loopId = null; }
    try {
      if (synth) { synth.releaseAll(); synth.dispose(); synth = null; }
      if (noise) { noise.stop(); noise.dispose(); noise = null; }
      if (pulse) { pulse.dispose(); pulse = null; }
    } catch (e) {}
    if (fab) fab.classList.remove('on');
    if (label) label.textContent = 'ENABLE FEED';
  }

  if (fab) {
    fab.addEventListener('click', function () {
      if (audioOn) {
        stopAudio();
      } else {
        if (typeof Tone === 'undefined') {
          if (label) label.textContent = 'FEED UNAVAILABLE';
          return;
        }
        Tone.start().then(startAudio).catch(function () {
          if (label) label.textContent = 'FEED BLOCKED';
        });
      }
    });
  }

  var konami = [38, 38, 40, 40, 37, 39, 37, 39, 66, 65];
  var idx = 0;
  document.addEventListener('keydown', function (e) {
    if (e.keyCode === konami[idx]) {
      idx++;
      if (idx === konami.length) {
        idx = 0;
        document.body.style.transition = 'filter 0.4s';
        document.body.style.filter = 'hue-rotate(120deg)';
        setTimeout(function () { document.body.style.filter = ''; }, 1800);
      }
    } else {
      idx = 0;
    }
  });
})();
