class App {
    ldClient;
    flags;
    api;
    voiceProvider;
    appConfig;
    appEnabled;
    nickname;
    transcriber;
    recording;
    speakButtonEl;
    passphraseEl;
    outputEl;
    providerEl;
    nicknameEl;
    appEnabledEl;
    canvas;
    canvasContext;
    audioContext;
    animationFrameId;
    visualizerStream;

    constructor() {
        this.recording = false;
        this.flags = {
            voiceProvider: { key: "config-voice-to-text-provider", default: "webspeech" },
            activeAppConfig: { key: "activeAppConfig", default: {} },
            passphrase: { key: "passphrase", default: "Let me in" },
            appEnabled: { key: "demoEnabled", default: false }
        };
    }

    async initialize() {
        await this.initializeLaunchDarkly();
        this.initializeDOMElements();
        this.initializeTranscriber();
        this.setupSpeakButton();
        await this.initializeAudioVisualization();
        return this;
    }

    async initializeLaunchDarkly() {
        try {
            this.nickname = await NicknameGenerator.generate();
            const context = { kind: "user", key: this.nickname };
            this.ldClient = LDClient.initialize("6682dc73b051d71068e2b6b1", context, { streaming: true });
            await this.ldClient.waitForInitialization(5);
            this.voiceProvider = this.ldClient.variation(this.flags.voiceProvider.key, this.flags.voiceProvider.default);
            this.appConfig = this.ldClient.variation(this.flags.activeAppConfig.key, this.flags.activeAppConfig.default)['config'];
            this.passphrase = this.ldClient.variation(this.flags.passphrase.key, this.flags.passphrase.default);
            this.appEnabled = this.ldClient.variation(this.flags.appEnabled.key, this.flags.appEnabled.default);
            this.ldClient.on(`change:${this.flags.voiceProvider.key}`, (value) => this.voiceProviderChanged(value));
            this.ldClient.on(`change:${this.flags.passphrase.key}`, (value) => this.passphraseChanged(value));
            this.ldClient.on(`change:${this.flags.appEnabled.key}`, (value) => this.updateAppEnabled(value));
            this.api = new LaunchDarklyAPI(this.appConfig.apiKey, this.appConfig.projectKey, this.appConfig.environmentKey);
        } catch (e) {
            console.error('Error initializing LaunchDarkly', e);
            this.voiceProvider = this.flags.voiceProvider.default;
        }
    }

    initializeDOMElements() {
        this.canvas = document.getElementById("visualizer");
        this.canvasContext = this.canvas.getContext("2d");
        this.speakButtonEl = document.getElementById('speakButton');
        this.outputEl = document.getElementById("transcription");
        this.nicknameEl = document.getElementById("nickname");
        this.providerEl = document.getElementById("provider");
        this.passphraseEl = document.getElementById("passphrase");
        this.appEnabledEl = document.getElementById("appEnabled");
        this.nicknameEl.innerText = this.nickname;
        this.passphraseEl.innerText = this.passphrase;
        this.outputEl.innerText = "(waiting for audio)";
        this.setDemoAccessMessage(this.appEnabled);
    }

    setupSpeakButton() {
        const stop = () => {
            this.recording = false;
            this.transcriber.stop();
            this.stopAudioVisualization();
            this.outputEl.innerText = "(waiting for audio)";
            this.speakButtonEl.innerText = "CLICK TO SPEAK";
            this.speakButtonEl.classList.remove("speakButtonRecording");
        };

        this.transcriber.element.addEventListener(this.transcriber.resulteventname, (event) => {
            stop();
            this.processTranscription(event.detail);
        });

        this.speakButtonEl.onclick = () => {
            if (!this.recording) {
                this.recording = true;
                this.speakButtonEl.innerText = "STOP";
                this.speakButtonEl.classList.add("speakButtonRecording");
                this.outputEl.innerText = "(listening)";
                this.startAudioVisualization();
                this.transcriber.start();
            } else {
                stop();
            }
        };
    }

    processTranscription(result) {
        result = result.trim().toLowerCase();
        this.outputEl.innerText = result;
        if (result == this.passphrase.toLowerCase()) {
            if (!this.appEnabled) {
                this.api.addUserKeyToSegment(this.appConfig.segmentKey, this.nickname);
            }
        }
    }

    initializeTranscriber() {
        const provider = this.voiceProvider?.toLowerCase();
        switch (provider) {
            case "webspeech": {
                this.transcriber = new WebSpeechTranscriber(this.appConfig);
                break;
            }
            case "whisper": {
                this.transcriber = new WhisperAudioTranscriber(this.appConfig);
                break;
            }
            default: {
                console.error('Unknown voice-to-speech provider', provider);
            }
        }
        this.providerEl.innerText = provider;
    }

    initializeAudioVisualization() {
        return new Promise((resolve, reject) => {
            if (navigator.mediaDevices.getUserMedia) {
                navigator.mediaDevices.getUserMedia({ audio: true, video: false }).then((stream) => {
                    this.visualizerStream = stream;
                    resolve();
                }, (e) => { console.error('getUserMedia error', e); reject(); });
            } else {
                console.error('getUserMedia not supported in this browser.');
                reject();
            }
        });
    }

    startAudioVisualization() {
        if (!this.audioContext) { this.audioContext = new AudioContext(); }
        const src = this.audioContext.createMediaStreamSource(this.visualizerStream);
        const analyzer = this.audioContext.createAnalyser();
        analyzer.fftSize = 2048;
        src.connect(analyzer);

        const bufferLength = analyzer.frequencyBinCount;
        const array = new Uint8Array(bufferLength);
        const drawWaveForm = () => {
            const width = this.canvas.width;
            const height = this.canvas.height;
            this.animationFrameId = requestAnimationFrame(drawWaveForm);
            analyzer.getByteTimeDomainData(array);

            this.canvasContext.fillStyle = "rgb(0,0,0)";
            this.canvasContext.fillRect(0, 0, width, height);
            this.canvasContext.lineWidth = 2;
            this.canvasContext.strokeStyle = "rgb(134 233 255)";
            this.canvasContext.beginPath();

            const sliceWidth = (width * 1.0) / bufferLength;
            let x = 0;
            for (let i = 0; i < bufferLength; i++) {
                let v = array[i] / 128.0;
                let y = (v * height) / 2;
                if (i === 0) {
                    this.canvasContext.moveTo(x, y);
                } else {
                    this.canvasContext.lineTo(x, y);
                }
                x += sliceWidth;
            }
            this.canvasContext.lineTo(this.canvas.width, this.canvas.height / 2);
            this.canvasContext.stroke();
        };

        drawWaveForm();
    }

    stopAudioVisualization() {
        cancelAnimationFrame(this.animationFrameId);
        this.canvasContext.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    voiceProviderChanged(newValue) {
        this.voiceProvider = newValue;
        this.transcriber.stop();
        this.transcriber = null;
        this.initializeTranscriber();
        this.setupSpeakButton();
    }

    passphraseChanged(newValue) {
        this.passphrase = newValue;
        this.passphraseEl.innerText = this.passphrase;
    }

    updateAppEnabled(newValue) {
        this.appEnabled = newValue;
        this.setDemoAccessMessage(this.appEnabled);
    }

    setDemoAccessMessage(demoEnabled) {
        const message = demoEnabled ? "Congrats, you get access to the demo!" : "Sorry, you don't have access to this demo.";
        this.appEnabledEl.innerText = message;
        this.appEnabledEl.classList.toggle("appEnabled", demoEnabled);
        this.appEnabledEl.classList.toggle("appDisabled", !demoEnabled);
    }

    run() {
    }
}

class AudioTranscriber {
    started = false;
    recognizer;
    element;
    resulteventname = 'result';
    constructor(config) {
        this.recognizer = new (window.SpeechRecognition || window.webkitSpeechRecognition || window.mozSpeechRecognition || window.msSpeechRecognition)();
        this.recognizer.continuous = false;
        this.recognizer.lang = 'en-US';
        this.recognizer.interimResults = false;
        this.recognizer.maxAlternatives = 1;
        this.element = document.createElement('div');
    }
    start() { }
    stop() {
        if (this.started) {
            this.started = false;
            this.recognizer.stop();
        }
    }
}

class WebSpeechTranscriber extends AudioTranscriber {
    constructor(config) {
        super(config);
        this.recognizer.onspeechend = () => { this.stop(); };
        this.recognizer.onresult = (event) => {
            this.element.dispatchEvent(new CustomEvent(this.resulteventname, { detail: event.results[0][0].transcript + '' }));
        };
    }

    start() {
        if (!this.started) {
            this.recognizer.start();
            this.started = true;
        }
    }
}

class WhisperAudioTranscriber extends AudioTranscriber {
    mediaRecorder;
    capturedAudioData;
    capturedAudioBlob;
    openAIKey;
    openAIUrl;
    constructor(config) {
        super(config);
        this.openAIKey = config.openAIKey;
        this.openAIUrl = config.openAIUrl;
        this.capturedAudioData = [];
    }

    start() {
        if (!this.started) {
            this.started = true;
            this.recognizer.onsoundend = (e) => { this.mediaRecorder.stop(); };
            this.recognizer.start();
            this.capturedAudioBlob = null;
            this.capturedAudioData.length = 0;
            if (navigator.mediaDevices.getUserMedia) {
                navigator.mediaDevices.getUserMedia({ audio: true, video: false })
                    .then((stream) => {
                        this.started = true;
                        this.mediaRecorder = new MediaRecorder(stream);
                        this.mediaRecorder.addEventListener('stop', async (e) => {
                            this.stop();
                            this.capturedAudioBlob = new Blob(this.capturedAudioData, { type: "audio/mp4" });
                            const text = await this.#getTextfromAudioViaWhisper(this.capturedAudioBlob);
                            this.element.dispatchEvent(new CustomEvent(this.resulteventname, { detail: text }));
                        });
                        this.mediaRecorder.ondataavailable = (e) => {
                            this.capturedAudioData.push(e.data);
                        };
                        this.mediaRecorder.start();
                    }, (err) => {
                        console.error('Unable to getUserMedia stream', err);
                    });
            } else {
                console.error('getUserMedia not supported in this browser.');
            }
        }
    }

    async #getTextfromAudioViaWhisper(audioBlob) {
        let result = "";
        try {
            const file = `audio.${audioBlob.type.split('/')[1]}`;
            const key = this.openAIKey;
            let data = new FormData();
            data.append("file", audioBlob, file);
            data.append("model", "whisper-1");
            data.append('temperature', '0');
            data.append('prompt', `Please transcribe the following audio accurately.`);
            const response = await fetch(this.openAIUrl, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${key}`
                },
                body: data
            });
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const json = await response.json();
            result = json.text;
            if (result.endsWith(".")) { result = result.slice(0, -1); }
        } catch (e) {
            console.error('fetch Error', e);
        } finally {
            return result;
        }
    }
}

class NicknameGenerator {
    static async generate() {
        let suffix = Math.floor(Math.random() * 1000) + 1;
        let nickname = `user-${suffix}`;
        try {
            const url = window.location.hostname == "localhost" ? "/nickname" : "https://namegen.com/more/usernames/";
            const response = await fetch(url, { method: 'GET' });
            const json = await response.json();
            nickname = `${json.result[0]}${suffix}`;
        } catch (e) {
            console.error(`Error fetching nickname from ${url}`, e);
        } finally {
            return nickname;
        }
    }
}

class LaunchDarklyAPI {
    LDProjectKey;
    LDEnvKey;
    LDApiKey;

    constructor(apiKey, projectKey, environmentKey) {
        this.LDApiKey = apiKey;
        this.LDProjectKey = projectKey;
        this.LDEnvKey = environmentKey;
    }

    // async addUserKeyToFlagRule(flagKey, contextKey) {
    //     try {
    //         const flag = await this.getFlag(flagKey);
    //         if (!flag.rules || flag.rules.length == 0) {
    //             await this.addEmptyRuleToFlag(flagKey);
    //         }
    //         const response = await fetch(`https://app.launchdarkly.com/api/v2/flags/${this.LDProjectKey}/${flagKey}`,
    //             {
    //                 method: 'PATCH',
    //                 headers: { 'Content-Type': 'application/json', Authorization: this.LDApiKey },
    //                 body: JSON.stringify({
    //                     patch: [
    //                         {
    //                             op: "add",
    //                             path: `/environments/${this.LDEnvKey}/rules/0/clauses/0/values/-`,
    //                             value: contextKey
    //                         }
    //                     ]
    //                 })
    //             }
    //         );
    //         if (!response.ok) {
    //             throw new Error(await response.text());
    //         }
    //     } catch (e) {
    //         console.error('Error adding user key to flag rule', e);
    //     }
    // }

    // async getFlag(flagKey) {
    //     let flag;
    //     try {
    //         const resp = await fetch(`https://app.launchdarkly.com/api/v2/flags/${this.LDProjectKey}/${flagKey}`,
    //             {
    //                 method: 'GET',
    //                 headers: { Authorization: this.LDApiKey }
    //             }
    //         );
    //         const json = await resp.json();
    //         flag = json.environments[`${this.LDEnvKey}`];
    //     } catch (e) {
    //         console.error('Error getting feature flag info', e);
    //     } finally {
    //         return flag || {};
    //     }
    // }

    // async addEmptyRuleToFlag(flagKey) {
    //     try {

    //         const response = await fetch(`https://app.launchdarkly.com/api/v2/flags/${this.LDProjectKey}/${flagKey}`,
    //             {
    //                 method: 'PATCH',
    //                 headers: { 'Content-Type': 'application/json', Authorization: this.LDApiKey },
    //                 body: JSON.stringify({
    //                     patch: [
    //                         {
    //                             op: "add",
    //                             path: `/environments/${this.LDEnvKey}/rules/-`,
    //                             value: {
    //                                 variation: 0,
    //                                 clauses: [
    //                                     {
    //                                         attribute: "key",
    //                                         op: "in",
    //                                         values: [App.appContext.key],
    //                                         contextKind: "user"
    //                                     }
    //                                 ],
    //                             }
    //                         }
    //                     ]
    //                 })
    //             }
    //         );
    //         if (!response.ok) {
    //             throw new Error(await response.text());
    //         }
    //     } catch (e) {
    //         console.error('Error adding empty rule to flag', e);
    //     }
    // }

    async addUserKeyToSegment(segmentKey, contextKey) {
        try {
            const response = await fetch(`https://app.launchdarkly.com/api/v2/segments/${this.LDProjectKey}/${this.LDEnvKey}/${segmentKey}`,
                {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json; domain-model=launchdarkly.semanticpatch',
                        Authorization: this.LDApiKey
                    },
                    body: JSON.stringify({
                        instructions: [
                            { kind: "addIncludedUsers", values: [`${contextKey}`] }
                        ]
                    })
                }
            );
            if (!response.ok) {
                throw new Error(await response.text());
            }
        } catch (e) {
            console.error('Error adding user key to segment', e);
        }
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    try {
        new App().initialize().then(app => app.run());
    } catch (e) {
        console.error("Error on DOMContentLoaded", e);
    }
});