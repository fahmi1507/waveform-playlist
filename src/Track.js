import _assign from "lodash.assign";
import _forOwn from "lodash.forown";

import { v4 as uuidv4 } from "uuid";
import h from "virtual-dom/h";

import extractPeaks from "webaudio-peaks";
import { FADEIN, FADEOUT } from "fade-maker";

import { secondsToPixels, secondsToSamples } from "./utils/conversions";
import stateClasses from "./track/states";

import CanvasHook from "./render/CanvasHook";
import FadeCanvasHook from "./render/FadeCanvasHook";
import VolumeSliderHook from "./render/VolumeSliderHook";
import StereoPanSliderHook from "./render/StereoPanSliderHook";
import Playout from "./Playout";

const MAX_CANVAS_WIDTH = 1000;

export default class {
  constructor() {
    this.name = "Untitled";
    this.customClass = undefined;
    this.waveOutlineColor = undefined;
    this.gain = 1;
    this.fades = {};
    this.peakData = {
      type: "WebAudio",
      mono: false,
    };

    this.cueIn = 0;
    this.cueOut = 0;
    this.duration = 0;
    this.startTime = 0;
    this.endTime = 0;
    this.stereoPan = 0;
  }

  setEventEmitter(ee) {
    this.ee = ee;
  }

  setName(name) {
    this.name = name;
  }

  setCustomClass(className) {
    this.customClass = className;
  }

  setWaveOutlineColor(color) {
    this.waveOutlineColor = color;
  }

  setCues(cueIn, cueOut) {
    if (cueOut < cueIn) {
      throw new Error("cue out cannot be less than cue in");
    }

    this.cueIn = cueIn;
    this.cueOut = cueOut;
    this.duration = this.cueOut - this.cueIn;
    this.endTime = this.startTime + this.duration;
  }

  /*
   *   start, end in seconds relative to the entire playlist.
   */
  trim(start, end) {
    const trackStart = this.getStartTime();
    const trackEnd = this.getEndTime();
    const offset = this.cueIn - trackStart;

    if (
      (trackStart <= start && trackEnd >= start) ||
      (trackStart <= end && trackEnd >= end)
    ) {
      const cueIn = start < trackStart ? trackStart : start;
      const cueOut = end > trackEnd ? trackEnd : end;

      this.setCues(cueIn + offset, cueOut + offset);
      if (start > trackStart) {
        this.setStartTime(start);
      }
    }
  }

  cut(start, end) {
    const audioContext = this.playout.ac;
    if (!audioContext) throw new Error("AudioContext is not available.");

    const channels = this.buffer.numberOfChannels;
    const sampleRate = this.buffer.sampleRate;
    const totalSamples = this.buffer.length;

    // Convert start and end times to sample indices
    const startSample = Math.round(start * sampleRate);
    const endSample = Math.round(end * sampleRate);

    // Validate the cut range
    if (startSample >= endSample || startSample < 0 || endSample > totalSamples) {
      throw new Error("Invalid cut range");
    }

    // Calculate the duration of the cut
    const cutDuration = (end - start); // Correct calculation of cut duration

    // Calculate the new buffer length
    const newBufferLength = totalSamples - (endSample - startSample);

    // Create a new buffer for the remaining audio
    const newBuffer = audioContext.createBuffer(channels, newBufferLength, sampleRate);

    for (let channel = 0; channel < channels; channel++) {
      const originalData = this.buffer.getChannelData(channel);
      const newData = newBuffer.getChannelData(channel);

      // Copy data before the cut
      newData.set(originalData.subarray(0, startSample), 0);

      // Copy data after the cut
      newData.set(originalData.subarray(endSample), startSample);
    }

    // Update the buffer with the new data
    this.setBuffer(newBuffer);
    this.playout = new Playout(audioContext, newBuffer, this.playout.masterGain);

    // Update cues and metadata
    const previousDuration = this.duration;
    this.setCues(this.cueIn, this.cueOut - cutDuration);
    this.duration = newBufferLength / sampleRate; // Update duration using buffer length
    this.endTime = this.startTime + this.duration;

    console.log('812')

    console.log({
      cutStart: start,
      cutEnd: end,
      cutStartSample: startSample,
      cutEndSample: endSample,
      cutDuration,
      previousDuration,
      newBufferLength,
      newDuration: this.duration,
    });
  }




  setStartTime(start) {
    this.startTime = start;
    this.endTime = start + this.duration;
  }

  setPlayout(playout) {
    this.playout = playout;
  }

  setOfflinePlayout(playout) {
    this.offlinePlayout = playout;
  }

  setEnabledStates(enabledStates = {}) {
    const defaultStatesEnabled = {
      cursor: true,
      fadein: true,
      fadeout: true,
      select: true,
      shift: true,
    };

    this.enabledStates = _assign({}, defaultStatesEnabled, enabledStates);
  }

  setFadeIn(pos, shape = "logarithmic") {
    const { start, end } = pos;

    console.table({ start, end });

    const fade = {
      shape,
      start,
      end,
    };

    // Initialize fadeIn as an array if it's not defined
    if (!this.fadeIn) {
      this.fadeIn = [];
    }

    // Save the new fade-in and store its ID
    const fadeId = this.saveFade(FADEIN, fade.shape, fade.start, fade.end);
    this.fadeIn.push(fadeId); // Add new fade-in to the list
  }


  setFadeOut(duration, shape = "logarithmic") {
    if (duration > this.duration) {
      throw new Error("Invalid Fade Out");
    }

    const fade = {
      shape,
      start: this.duration - duration,
      end: this.duration,
    };

    if (this.fadeOut) {
      this.removeFade(this.fadeOut);
      this.fadeOut = undefined;
    }

    this.fadeOut = this.saveFade(FADEOUT, fade.shape, fade.start, fade.end);
  }

  saveFade(type, shape, start, end) {
    const id = uuidv4();

    this.fades[id] = {
      type,
      shape,
      start,
      end,
    };

    return id;
  }

  removeFade(id) {
    delete this.fades[id];
  }

  setBuffer(buffer) {
    this.buffer = buffer;
  }

  setPeakData(data) {
    this.peakData = data;
  }

  calculatePeaks(samplesPerPixel, sampleRate) {
    const cueIn = secondsToSamples(this.cueIn, sampleRate);
    const cueOut = secondsToSamples(this.cueOut, sampleRate);

    this.setPeaks(
      extractPeaks(
        this.buffer,
        samplesPerPixel,
        this.peakData.mono,
        cueIn,
        cueOut
      )
    );
  }

  setPeaks(peaks) {
    this.peaks = peaks;
  }

  setState(state) {
    this.state = state;

    if (this.state && this.enabledStates[this.state]) {
      const StateClass = stateClasses[this.state];
      this.stateObj = new StateClass(this);
    } else {
      this.stateObj = undefined;
    }
  }

  getStartTime() {
    return this.startTime;
  }

  getEndTime() {
    return this.endTime;
  }

  getDuration() {
    return this.duration;
  }

  isPlaying() {
    return this.playout.isPlaying();
  }

  setShouldPlay(bool) {
    this.playout.setShouldPlay(bool);
  }

  setGainLevel(level) {
    this.gain = level;
    this.playout.setVolumeGainLevel(level);
  }

  setMasterGainLevel(level) {
    this.playout.setMasterGainLevel(level);
  }

  setStereoPanValue(value) {
    this.stereoPan = value;
    this.playout.setStereoPanValue(value);
  }

  setEffects(effectsGraph) {
    this.effectsGraph = effectsGraph;
    this.playout.setEffects(effectsGraph);
  }

  /*
    startTime, endTime in seconds (float).
    segment is for a highlighted section in the UI.

    returns a Promise that will resolve when the AudioBufferSource
    is either stopped or plays out naturally.
  */
  schedulePlay(now, startTime, endTime, config) {
    let start;
    let duration;
    let when = now;
    let segment = endTime ? endTime - startTime : undefined;

    const defaultOptions = {
      shouldPlay: true,
      masterGain: 1,
      isOffline: false,
    };

    const options = _assign({}, defaultOptions, config);
    const playoutSystem = options.isOffline ? this.offlinePlayout : this.playout;

    // 1) track has no content to play.
    // 2) track does not play in this selection.
    if (this.endTime <= startTime || (segment && startTime + segment < this.startTime)) {
      return Promise.resolve(); // return a resolved promise since this track is technically "stopped".
    }

    // track should have something to play if it gets here.

    // the track starts in the future or on the cursor position
    if (this.startTime >= startTime) {
      start = 0;
      when += this.startTime - startTime;

      if (endTime) {
        segment -= this.startTime - startTime;
        duration = Math.min(segment, this.duration);
      } else {
        duration = this.duration;
      }
    } else {
      start = startTime - this.startTime;

      if (endTime) {
        duration = Math.min(segment, this.duration - start);
      } else {
        duration = this.duration - start;
      }
    }

    start += this.cueIn;
    const relPos = startTime - this.startTime;
    const sourcePromise = playoutSystem.setUpSource();

    // Apply all fade-ins
    if (this.fadeIn && Array.isArray(this.fadeIn) && this.fadeIn.length > 0) {
      this.fadeIn.forEach((fadeId) => {
        const fade = this.fades[fadeId];
        if (!fade) return;

        let fadeStart;
        let fadeDuration;

        // Only apply fade-in if it happens after the current playback position
        if (relPos < fade.end) {
          if (relPos <= fade.start) {
            fadeStart = now + (fade.start - relPos);
            fadeDuration = fade.end - fade.start;
          } else if (relPos > fade.start && relPos < fade.end) {
            fadeStart = now - (relPos - fade.start);
            fadeDuration = fade.end - fade.start;
          }

          playoutSystem.applyFadeIn(fadeStart, fadeDuration, fade.shape);
        }
      });
    }

    // Apply fade-out logic (unchanged)
    _forOwn(this.fades, (fade) => {
      let fadeStart;
      let fadeDuration;

      // only apply fade if it's ahead of the cursor.
      if (relPos < fade.end) {
        if (relPos <= fade.start) {
          fadeStart = now + (fade.start - relPos);
          fadeDuration = fade.end - fade.start;
        } else if (relPos > fade.start && relPos < fade.end) {
          fadeStart = now - (relPos - fade.start);
          fadeDuration = fade.end - fade.start;
        }

        switch (fade.type) {
          case FADEIN:
            // Skip fade-in here since it's already handled above
            break;
          case FADEOUT:
            playoutSystem.applyFadeOut(fadeStart, fadeDuration, fade.shape);
            break;
          default:
            throw new Error("Invalid fade type saved on track.");
        }
      }
    });

    playoutSystem.setVolumeGainLevel(this.gain);
    playoutSystem.setShouldPlay(options.shouldPlay);
    playoutSystem.setMasterGainLevel(options.masterGain);
    playoutSystem.setStereoPanValue(this.stereoPan);
    playoutSystem.play(when, start, duration);

    return sourcePromise;
  }


  scheduleStop(when = 0) {
    this.playout.stop(when);
  }

  renderOverlay(data) {
    const channelPixels = secondsToPixels(
      data.playlistLength,
      data.resolution,
      data.sampleRate
    );

    const config = {
      attributes: {
        style: `position: absolute; top: 0; right: 0; bottom: 0; left: 0; width: ${channelPixels}px; z-index: 9;`,
      },
    };

    let overlayClass = "";

    if (this.stateObj) {
      this.stateObj.setup(data.resolution, data.sampleRate);
      const StateClass = stateClasses[this.state];
      const events = StateClass.getEvents();

      events.forEach((event) => {
        config[`on${event}`] = this.stateObj[event].bind(this.stateObj);
      });

      overlayClass = StateClass.getClass();
    }
    // use this overlay for track event cursor position calculations.
    return h(`div.playlist-overlay${overlayClass}`, config);
  }

  renderControls(data) {
    const muteClass = data.muted ? ".active" : "";
    const soloClass = data.soloed ? ".active" : "";
    const isCollapsed = data.collapsed;
    const numChan = this.peaks.data.length;
    const widgets = data.controls.widgets;

    const removeTrack = h(
      "button.btn.btn-danger.btn-xs.track-remove",
      {
        attributes: {
          type: "button",
          title: "Remove track",
        },
        onclick: () => {
          this.ee.emit("removeTrack", this);
        },
      },
      [h("i.fas.fa-times")]
    );

    const trackName = h("span", [this.name]);

    const collapseTrack = h(
      "button.btn.btn-info.btn-xs.track-collapse",
      {
        attributes: {
          type: "button",
          title: isCollapsed ? "Expand track" : "Collapse track",
        },
        onclick: () => {
          this.ee.emit("changeTrackView", this, {
            collapsed: !isCollapsed,
          });
        },
      },
      [h(`i.fas.${isCollapsed ? "fa-caret-down" : "fa-caret-up"}`)]
    );

    const headerChildren = [];

    if (widgets.remove) {
      headerChildren.push(removeTrack);
    }
    headerChildren.push(trackName);
    if (widgets.collapse) {
      headerChildren.push(collapseTrack);
    }

    const controls = [h("div.track-header", headerChildren)];

    if (!isCollapsed) {
      if (widgets.muteOrSolo) {
        controls.push(
          h("div.btn-group", [
            h(
              `button.btn.btn-outline-dark.btn-xs.btn-mute${muteClass}`,
              {
                attributes: {
                  type: "button",
                },
                onclick: () => {
                  this.ee.emit("mute", this);
                },
              },
              ["Mute"]
            ),
            h(
              `button.btn.btn-outline-dark.btn-xs.btn-solo${soloClass}`,
              {
                onclick: () => {
                  this.ee.emit("solo", this);
                },
              },
              ["Solo"]
            ),
          ])
        );
      }

      if (widgets.volume) {
        controls.push(
          h("label.volume", [
            h("input.volume-slider", {
              attributes: {
                "aria-label": "Track volume control",
                type: "range",
                min: 0,
                max: 100,
                value: 100,
              },
              hook: new VolumeSliderHook(this.gain),
              oninput: (e) => {
                this.ee.emit("volumechange", e.target.value, this);
              },
            }),
          ])
        );
      }

      if (widgets.stereoPan) {
        controls.push(
          h("label.stereopan", [
            h("input.stereopan-slider", {
              attributes: {
                "aria-label": "Track stereo pan control",
                type: "range",
                min: -100,
                max: 100,
                value: 100,
              },
              hook: new StereoPanSliderHook(this.stereoPan),
              oninput: (e) => {
                this.ee.emit("stereopan", e.target.value / 100, this);
              },
            }),
          ])
        );
      }
    }

    return h(
      "div.controls",
      {
        attributes: {
          style: `height: ${numChan * data.height}px; width: ${data.controls.width
            }px; position: absolute; left: 0; z-index: 10;`,
        },
      },
      controls
    );
  }

  render(data) {
    const width = this.peaks.length;
    const playbackX = secondsToPixels(
      data.playbackSeconds,
      data.resolution,
      data.sampleRate
    );
    const startX = secondsToPixels(
      this.startTime,
      data.resolution,
      data.sampleRate
    );
    const endX = secondsToPixels(
      this.endTime,
      data.resolution,
      data.sampleRate
    );
    let progressWidth = 0;
    const numChan = this.peaks.data.length;
    const scale = Math.ceil(window.devicePixelRatio);

    if (playbackX > 0 && playbackX > startX) {
      if (playbackX < endX) {
        progressWidth = playbackX - startX;
      } else {
        progressWidth = width;
      }
    }

    const waveformChildren = [
      h("div.cursor", {
        attributes: {
          style: `position: absolute; width: 1px; margin: 0; padding: 0; top: 0; left: ${playbackX}px; bottom: 0; z-index: 5;`,
        },
      }),
    ];

    const closeButton = (fadeId) =>
      h(
        "button",
        {
          attributes: {
            class: "close-button",
            style: `
                      position: absolute;
                      bottom: -10px;
                      right: 5px;
                      background: rgba(255, 0, 0, 0.7);
                      color: white;
                      border: none;
                      border-radius: 50%;
                      width: 14px;
                      height: 14px;
                      font-size: 10px;
                      cursor: pointer; /* ✅ Ensures pointer on hover */
                      z-index: 999999;
                  `,
            title: "Remove Fade",
          },
          onclick: (event) => {
            event.stopPropagation(); // ✅ Prevents event from interfering with other handlers
            console.log(`Removing fade-in: ${fadeId}`);

            // ✅ Remove fade
            if (this.fades[fadeId]) {
              delete this.fades[fadeId];
              this.fadeIn = this.fadeIn.filter(id => id !== fadeId);

              this.ee.emit("redraw");
            }
          },
        },
        "✖"
      );


    const channels = Object.keys(this.peaks.data).map((channelNum) => {
      const channelChildren = [
        h("div.channel-progress", {
          attributes: {
            style: `position: absolute; width: ${progressWidth}px; height: ${data.height}px; z-index: 2;`,
          },
        }),
      ];
      let offset = 0;
      let totalWidth = width;
      const peaks = this.peaks.data[channelNum];

      while (totalWidth > 0) {
        const currentWidth = Math.min(totalWidth, MAX_CANVAS_WIDTH);
        const canvasColor = this.waveOutlineColor
          ? this.waveOutlineColor
          : data.colors.waveOutlineColor;

        channelChildren.push(
          h("canvas", {
            attributes: {
              width: currentWidth * scale,
              height: data.height * scale,
              style: `float: left; position: relative; margin: 0; padding: 0; z-index: 3; width: ${currentWidth}px; height: ${data.height}px;`,
            },
            hook: new CanvasHook(
              peaks,
              offset,
              this.peaks.bits,
              canvasColor,
              scale,
              data.height,
              data.barWidth,
              data.barGap
            ),
          })
        );

        totalWidth -= currentWidth;
        offset += MAX_CANVAS_WIDTH;
      }

      // === 🔹 Display multiple fade-ins instead of just one ===
      if (this.fadeIn && Array.isArray(this.fadeIn) && this.fadeIn.length > 0) {
        this.fadeIn.forEach((fadeId) => {
          const fadeIn = this.fades[fadeId];
          if (!fadeIn) return;

          const fadeWidth = secondsToPixels(
            fadeIn.end - fadeIn.start,
            data.resolution,
            data.sampleRate
          );

          const startingPoint = secondsToPixels(
            fadeIn.start,
            data.resolution,
            data.sampleRate
          );

          console.log(`Rendering fade-in at ${startingPoint} width ${fadeWidth}`);

          channelChildren.push(
            h(
              "div.wp-fade.wp-fadein",
              {
                attributes: {
                  style: `position: absolute; height: ${data.height}px; width: ${fadeWidth}px; top: 0; left: ${startingPoint}px; z-index: 4;`,
                },
              },
              [
                h("canvas", {
                  attributes: {
                    width: fadeWidth,
                    height: data.height,
                  },
                  hook: new FadeCanvasHook(
                    fadeIn.type,
                    fadeIn.shape,
                    fadeIn.end - fadeIn.start,
                    data.resolution
                  ),
                }),

                closeButton(fadeId), // ✅ Add close button per fade

              ]
            )
          );
        });
      }

      // === ✅ Fade-out logic remains unchanged ===
      if (this.fadeOut) {
        const fadeOut = this.fades[this.fadeOut];
        const fadeWidth = secondsToPixels(
          fadeOut.end - fadeOut.start,
          data.resolution,
          data.sampleRate
        );

        channelChildren.push(
          h(
            "div.wp-fade.wp-fadeout",
            {
              attributes: {
                style: `position: absolute; height: ${data.height}px; width: ${fadeWidth}px; top: 0; right: 0; z-index: 4;`,
              },
            },
            [
              h("canvas", {
                attributes: {
                  width: fadeWidth,
                  height: data.height,
                },
                hook: new FadeCanvasHook(
                  fadeOut.type,
                  fadeOut.shape,
                  fadeOut.end - fadeOut.start,
                  data.resolution
                ),
              }),
            ]
          )
        );
      }

      return h(
        `div.channel.channel-${channelNum}`,
        {
          attributes: {
            style: `height: ${data.height}px; width: ${width}px; top: ${channelNum * data.height
              }px; left: ${startX}px; position: absolute; margin: 0; padding: 0; z-index: 1;`,
          },
        },
        channelChildren
      );
    });

    waveformChildren.push(channels);
    waveformChildren.push(this.renderOverlay(data));

    // draw cursor selection on active track.
    if (data.isActive === true) {
      const cStartX = secondsToPixels(
        data.timeSelection.start,
        data.resolution,
        data.sampleRate
      );
      const cEndX = secondsToPixels(
        data.timeSelection.end,
        data.resolution,
        data.sampleRate
      );
      const cWidth = cEndX - cStartX + 1;
      const cClassName = cWidth > 1 ? ".segment" : ".point";

      waveformChildren.push(
        h(`div.selection${cClassName}`, {
          attributes: {
            style: `position: absolute; width: ${cWidth}px; bottom: 0; top: 0; left: ${cStartX}px; z-index: 4;`,
          },
        })
      );
    }

    const waveform = h(
      "div.waveform",
      {
        attributes: {
          style: `height: ${numChan * data.height}px; position: relative;`,
        },
      },
      waveformChildren
    );

    const channelChildren = [];
    let channelMargin = 0;

    if (data.controls.show) {
      channelChildren.push(this.renderControls(data));
      channelMargin = data.controls.width;
    }

    channelChildren.push(waveform);

    const audibleClass = data.shouldPlay ? "" : ".silent";
    const customClass =
      this.customClass === undefined ? "" : `.${this.customClass}`;

    return h(
      `div.channel-wrapper${audibleClass}${customClass}`,
      {
        attributes: {
          style: `margin-left: ${channelMargin}px; height: ${data.height * numChan}px;`,
        },
      },
      channelChildren
    );
  }


  getTrackDetails() {
    const info = {
      src: this.src,
      start: this.startTime,
      end: this.endTime,
      name: this.name,
      customClass: this.customClass,
      cuein: this.cueIn,
      cueout: this.cueOut,
      stereoPan: this.stereoPan,
      gain: this.gain,
      effects: this.effectsGraph,
    };

    if (this.fadeIn) {
      const fadeIn = this.fades[this.fadeIn];

      info.fadeIn = {
        shape: fadeIn.shape,
        duration: fadeIn.end - fadeIn.start,
      };
    }

    if (this.fadeOut) {
      const fadeOut = this.fades[this.fadeOut];

      info.fadeOut = {
        shape: fadeOut.shape,
        duration: fadeOut.end - fadeOut.start,
      };
    }

    return info;
  }

  // fahmi
  saveState() {
    return {
      buffer: this.buffer, // Save the original audio buffer
      cueIn: this.cueIn,
      cueOut: this.cueOut,
      startTime: this.startTime,
      endTime: this.endTime,
      duration: this.duration,
    };
  }


  restoreState(state) {
    if (!state) return;

    this.buffer = state.buffer; // Restore the original buffer
    this.setBuffer(this.buffer); // Update Playout
    this.cueIn = state.cueIn;
    this.cueOut = state.cueOut;
    this.startTime = state.startTime;
    this.endTime = state.endTime;
    this.duration = state.duration;

    this.playout = new Playout(this.playout.ac, this.buffer, this.playout.masterGain);
  }

}
