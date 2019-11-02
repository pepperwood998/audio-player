class AudioStream {
    constructor(socketUri, numChannels = 2, sampleRate = 44100) {
        window.AudioContext = window.AudioContext || window.webkitAudioContext;
        this.socketUri = socketUri;
        this.socket = null;
        this.numChannels = numChannels;
        this.sampleRate = sampleRate;

        this.ctx = new AudioContext();
        this.ctx.onstatechange = function() {};

        this.uuid = '';
        this.cache = [];
        this.tempCache = [];

        this.times = {
            initPoint: 0,
            newPartPoint: 0,
            pausePoint: 0,

            totalBuffDur: 0,
            buffInCtxDur: 0,
            nextTimeout: 0,
            maxPartDur: 5,

            updateIndicator: 0,
            updateThreshold: 0,
            partSpaceDur: 1
        };

        this.states = {
            isStreamInit: false, // init
            isPlaying: false, // running
            isEnded: false,

            isPreparedOnce: false, // onInitPrepareCall

            isResumed: false, // isResume
            isInResume: false, // onResumeBefore
            isResumedAfter: false, // newPlay
            resumedAfterLock: false
        };
    }

    connect() {
        this.socket = new WebSocket(this.socketUri);
        let json = {
            data: '',
            lastBuffer: false,
            isEnded: false
        };
        this.socket.onmessage = ev => {
            json = JSON.parse(ev.data);

            if (json.isEnded) {
                this.states.isEnded = true;
                this.temp();
                return;
            }

            json.data = base64ToArrayBuffer(json.data);
            this.ctx
                .decodeAudioData(
                    withWaveHeader(json.data, this.numChannels, this.sampleRate)
                )
                .then(buffer => {
                    console.log('----', 'incoming:', 'decoded', '----');
                    this.cache.push(buffer);
                    this.times.totalBuffDur += buffer.duration;
                    this.times.updateIndicator += buffer.duration;

                    if (json.lastBuffer) {
                        this.temp();
                    }
                })
                .catch(console.error);
        };
    }

    togglePlayback() {
        if (!this.states.isStreamInit) {
            this.states.isStreamInit = true;
            this.states.isPlaying = true;

            this.requestAudioChunk();
            return;
        }

        if (this.ctx.state === 'running') {
            this.ctx.suspend().then(() => {
                this.states.isPlaying = false;
                this.states.isResumedAfter = false;
                this.times.pausePoint = Date.now();
            });
        } else if (this.ctx.state === 'suspended') {
            this.ctx.resume().then(() => {
                this.states.isPlaying = true;
                if (this.states.resumedAfterLock) return;

                if (!this.states.isResumedAfter) {
                    // prevent continuous resume-before
                    if (!this.states.isInResume) {
                        this.states.isInResume = true;
                        this.states.isResumed = true;
                        this.prepareAudio(
                            this.times.nextTimeout -
                                (this.times.pausePoint -
                                    this.times.newPartPoint) /
                                    1000
                        );
                    }
                } else {
                    // set lock to prevent prepare-call by resume on the next part
                    this.states.resumedAfterLock = true;
                    this.prepareAudio(this.times.nextTimeout);
                }
            });
        }
    }

    prepareAudio(thisTimeout) {
        let timeCounter = 0;
        let part = [];
        let buffer;

        while (this.cache.length) {
            buffer = this.cache.shift();
            part.push(buffer);
            this.tempCache.push(buffer);

            timeCounter += buffer.duration;
            if (timeCounter >= this.times.maxPartDur || !this.cache.length) {
                this.times.newPartPoint = Date.now();
                this.times.nextTimeout = timeCounter - this.times.partSpaceDur;
                // small reset
                this.times.partSpaceDur = 0;

                ((part, timeout, thisDuration) => {
                    setTimeout(() => {
                        // setting the checkpoint
                        this.states.isResumedAfter = true;
                        this.states.isInResume = false;

                        asyncCall(() => this.playAudio(part));

                        asyncCall(() => {
                            this.times.updateIndicator -= thisDuration;

                            if (
                                !this.states.isEnded &&
                                this.times.updateIndicator <
                                    this.times.updateThreshold
                            ) {
                                console.log(this.times.updateIndicator);
                                let dur = this.times.updateThreshold;
                                this.times.updateThreshold = 0;
                                while (this.tempCache.length && dur > 0) {
                                    dur -= this.tempCache.shift().duration;
                                }

                                this.requestAudioChunk();
                            }
                        });

                        if (this.states.isPlaying && !this.states.isResumed) {
                            this.prepareAudio(this.times.nextTimeout);
                            console.log('timeout-ed', 'continuous call');
                        } else {
                            console.log('timeout-ed', 'new call');
                        }

                        // reset
                        this.states.isResumed = false;
                        this.states.resumedAfterLock = false;
                    }, timeout * 1000);
                })(part, thisTimeout, timeCounter);

                break;
            }
        }
    }

    playAudio(bufferArr) {
        while (bufferArr.length) {
            console.log('playing');
            let buffer = bufferArr.shift();

            let source = this.ctx.createBufferSource();
            source.buffer = buffer;
            source.connect(this.ctx.destination);
            source.start(this.times.buffInCtxDur);

            this.times.buffInCtxDur += buffer.duration;
        }
    }

    requestAudioChunk() {
        let req = {
            uuid: this.uuid,
            timePoint: this.times.initPoint + this.times.totalBuffDur
        };
        this.socket.send(JSON.stringify(req));
    }

    temp() {
        this.times.updateThreshold = this.times.updateIndicator / 2;

        if (!this.states.isPreparedOnce) {
            this.states.isPreparedOnce = true;
            this.prepareAudio(this.times.nextTimeout);
        }
    }
}
