import type { Analyser } from "./analyser";

import type { Nullable } from "../types";
import { Observable } from "../Misc/observable";
import { Logger } from "../Misc/logger";
import { AbstractEngine } from "../Engines/abstractEngine";
import type { IAudioEngine } from "./Interfaces/IAudioEngine";
import { IsWindowObjectExist } from "../Misc/domManagement";

// Sets the default audio engine to Babylon.js
AbstractEngine.AudioEngineFactory = (
    hostElement: Nullable<HTMLElement>,
    audioContext: Nullable<AudioContext>,
    audioDestination: Nullable<AudioDestinationNode | MediaStreamAudioDestinationNode>
) => {
    return new AudioEngine(hostElement, audioContext, audioDestination);
};

/**
 * This represents the default audio engine used in babylon.
 * It is responsible to play, synchronize and analyse sounds throughout the  application.
 * @see https://doc.babylonjs.com/features/featuresDeepDive/audio/playingSoundsMusic
 */
export class AudioEngine implements IAudioEngine {
    private _audioContext: Nullable<AudioContext> = null;
    private _audioContextInitialized = false;
    private _muteButton: Nullable<HTMLButtonElement> = null;
    private _hostElement: Nullable<HTMLElement>;
    private _audioDestination: Nullable<AudioDestinationNode | MediaStreamAudioDestinationNode> = null;

    /**
     * Gets whether the current host supports Web Audio and thus could create AudioContexts.
     */
    public canUseWebAudio: boolean = false;

    /**
     * The master gain node defines the global audio volume of your audio engine.
     */
    public masterGain: GainNode;

    /**
     * Defines if Babylon should emit a warning if WebAudio is not supported.
     */
    // eslint-disable-next-line @typescript-eslint/naming-convention
    public WarnedWebAudioUnsupported: boolean = false;

    /**
     * Gets whether or not mp3 are supported by your browser.
     */
    public isMP3supported: boolean = false;

    /**
     * Gets whether or not ogg are supported by your browser.
     */
    public isOGGsupported: boolean = false;

    /**
     * Gets whether audio has been unlocked on the device.
     * Some Browsers have strong restrictions about Audio and won't autoplay unless
     * a user interaction has happened.
     */
    public unlocked: boolean = false;

    /**
     * Defines if the audio engine relies on a custom unlocked button.
     * In this case, the embedded button will not be displayed.
     */
    public useCustomUnlockedButton: boolean = false;

    /**
     * Event raised when audio has been unlocked on the browser.
     */
    public onAudioUnlockedObservable = new Observable<IAudioEngine>();

    /**
     * Event raised when audio has been locked on the browser.
     */
    public onAudioLockedObservable = new Observable<IAudioEngine>();

    /**
     * Gets the current AudioContext if available.
     */
    public get audioContext(): Nullable<AudioContext> {
        if (!this._audioContextInitialized) {
            this._initializeAudioContext();
        }
        return this._audioContext;
    }

    private _connectedAnalyser: Nullable<Analyser>;

    /**
     * Instantiates a new audio engine.
     *
     * There should be only one per page as some browsers restrict the number
     * of audio contexts you can create.
     * @param hostElement defines the host element where to display the mute icon if necessary
     * @param audioContext defines the audio context to be used by the audio engine
     * @param audioDestination defines the audio destination node to be used by audio engine
     */
    constructor(
        hostElement: Nullable<HTMLElement> = null,
        audioContext: Nullable<AudioContext> = null,
        audioDestination: Nullable<AudioDestinationNode | MediaStreamAudioDestinationNode> = null
    ) {
        if (!IsWindowObjectExist()) {
            return;
        }
        if (typeof window.AudioContext !== "undefined") {
            this.canUseWebAudio = true;
        }

        const audioElem = document.createElement("audio");
        this._hostElement = hostElement;
        this._audioContext = audioContext;
        this._audioDestination = audioDestination;

        try {
            if (
                audioElem &&
                !!audioElem.canPlayType &&
                (audioElem.canPlayType('audio/mpeg; codecs="mp3"').replace(/^no$/, "") || audioElem.canPlayType("audio/mp3").replace(/^no$/, ""))
            ) {
                this.isMP3supported = true;
            }
        } catch (e) {
            // protect error during capability check.
        }

        try {
            if (audioElem && !!audioElem.canPlayType && audioElem.canPlayType('audio/ogg; codecs="vorbis"').replace(/^no$/, "")) {
                this.isOGGsupported = true;
            }
        } catch (e) {
            // protect error during capability check.
        }
    }

    /**
     * Flags the audio engine in Locked state.
     * This happens due to new browser policies preventing audio to autoplay.
     */
    public lock() {
        this._triggerSuspendedState();
    }

    /**
     * Unlocks the audio engine once a user action has been done on the dom.
     * This is helpful to resume play once browser policies have been satisfied.
     */
    public unlock() {
        if (this._audioContext?.state === "running") {
            this._hideMuteButton();

            if (!this.unlocked) {
                // Notify users that the audio stack is unlocked/unmuted
                this.unlocked = true;
                this.onAudioUnlockedObservable.notifyObservers(this);
            }

            return;
        }

        // On iOS, if the audio context resume request was sent from an event other than a `click` event, then
        // the resume promise will never resolve and the only way to get the audio context unstuck is to
        // suspend it and make another resume request.
        if (this._tryToRun) {
            // eslint-disable-next-line github/no-then
            this._audioContext?.suspend().then(
                () => {
                    this._tryToRun = false;
                    // eslint-disable-next-line @typescript-eslint/no-floating-promises
                    this._triggerRunningStateAsync();
                },
                () => {
                    Logger.Error("Failed to suspend audio context.");
                }
            );
        } else {
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            this._triggerRunningStateAsync();
        }
    }

    /** @internal */
    public _resumeAudioContextOnStateChange(): void {
        this._audioContext?.addEventListener(
            "statechange",
            () => {
                if (this.unlocked && this._audioContext?.state !== "running") {
                    // eslint-disable-next-line @typescript-eslint/no-floating-promises
                    this._resumeAudioContextAsync();
                }
            },
            {
                once: true,
                passive: true,
                signal: AbortSignal.timeout(3000),
            }
        );
    }

    // eslint-disable-next-line @typescript-eslint/promise-function-async, no-restricted-syntax
    private _resumeAudioContextAsync(): Promise<void> {
        if (this._audioContext?.resume) {
            return this._audioContext.resume();
        }

        return Promise.resolve();
    }

    private _initializeAudioContext() {
        try {
            if (this.canUseWebAudio) {
                if (!this._audioContext) {
                    this._audioContext = new AudioContext();
                }
                // create a global volume gain node
                this.masterGain = this._audioContext.createGain();
                this.masterGain.gain.value = 1;
                if (!this._audioDestination) {
                    this._audioDestination = this._audioContext.destination;
                }
                this.masterGain.connect(this._audioDestination);
                this._audioContextInitialized = true;
                if (this._audioContext.state === "running") {
                    // Do not wait for the promise to unlock.
                    // eslint-disable-next-line @typescript-eslint/no-floating-promises
                    this._triggerRunningStateAsync();
                }
            }
        } catch (e) {
            this.canUseWebAudio = false;
            Logger.Error("Web Audio: " + e.message);
        }
    }

    private _tryToRun = false;
    private async _triggerRunningStateAsync() {
        if (this._tryToRun) {
            return;
        }
        this._tryToRun = true;

        try {
            await this._resumeAudioContextAsync();
            this._tryToRun = false;
            if (this._muteButton) {
                this._hideMuteButton();
            }
            // Notify users that the audio stack is unlocked/unmuted
            this.unlocked = true;
            this.onAudioUnlockedObservable.notifyObservers(this);
        } catch (_e) {
            this._tryToRun = false;
            this.unlocked = false;
        }
    }

    private _triggerSuspendedState() {
        this.unlocked = false;
        this.onAudioLockedObservable.notifyObservers(this);
        this._displayMuteButton();
    }

    private _displayMuteButton() {
        if (this.useCustomUnlockedButton || this._muteButton) {
            return;
        }

        this._muteButton = <HTMLButtonElement>document.createElement("BUTTON");
        this._muteButton.className = "babylonUnmuteIcon";
        this._muteButton.id = "babylonUnmuteIconBtn";
        this._muteButton.title = "Unmute";
        const imageUrl = !window.SVGSVGElement
            ? "https://cdn.babylonjs.com/Assets/audio.png"
            : "data:image/svg+xml;charset=UTF-8,%3Csvg%20version%3D%221.1%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2239%22%20height%3D%2232%22%20viewBox%3D%220%200%2039%2032%22%3E%3Cpath%20fill%3D%22white%22%20d%3D%22M9.625%2018.938l-0.031%200.016h-4.953q-0.016%200-0.031-0.016v-12.453q0-0.016%200.031-0.016h4.953q0.031%200%200.031%200.016v12.453zM12.125%207.688l8.719-8.703v27.453l-8.719-8.719-0.016-0.047v-9.938zM23.359%207.875l1.406-1.406%204.219%204.203%204.203-4.203%201.422%201.406-4.219%204.219%204.219%204.203-1.484%201.359-4.141-4.156-4.219%204.219-1.406-1.422%204.219-4.203z%22%3E%3C%2Fpath%3E%3C%2Fsvg%3E";

        const css =
            ".babylonUnmuteIcon { position: absolute; left: 20px; top: 20px; height: 40px; width: 60px; background-color: rgba(51,51,51,0.7); background-image: url(" +
            imageUrl +
            ");  background-size: 80%; background-repeat:no-repeat; background-position: center; background-position-y: 4px; border: none; outline: none; transition: transform 0.125s ease-out; cursor: pointer; z-index: 9999; } .babylonUnmuteIcon:hover { transform: scale(1.05) } .babylonUnmuteIcon:active { background-color: rgba(51,51,51,1) }";

        const style = document.createElement("style");
        style.appendChild(document.createTextNode(css));
        document.getElementsByTagName("head")[0].appendChild(style);

        document.body.appendChild(this._muteButton);

        this._moveButtonToTopLeft();

        this._muteButton.addEventListener(
            "touchend",
            () => {
                // eslint-disable-next-line @typescript-eslint/no-floating-promises
                this._triggerRunningStateAsync();
            },
            true
        );
        this._muteButton.addEventListener(
            "click",
            () => {
                this.unlock();
            },
            true
        );

        window.addEventListener("resize", this._onResize);
    }

    private _moveButtonToTopLeft() {
        if (this._hostElement && this._muteButton) {
            this._muteButton.style.top = this._hostElement.offsetTop + 20 + "px";
            this._muteButton.style.left = this._hostElement.offsetLeft + 20 + "px";
        }
    }

    private _onResize = () => {
        this._moveButtonToTopLeft();
    };

    private _hideMuteButton() {
        if (this._muteButton) {
            document.body.removeChild(this._muteButton);
            this._muteButton = null;
        }
    }

    /**
     * Destroy and release the resources associated with the audio context.
     */
    public dispose(): void {
        if (this.canUseWebAudio && this._audioContextInitialized) {
            if (this._connectedAnalyser && this._audioContext) {
                this._connectedAnalyser.stopDebugCanvas();
                this._connectedAnalyser.dispose();
                this.masterGain.disconnect();
                this.masterGain.connect(this._audioContext.destination);
                this._connectedAnalyser = null;
            }
            this.masterGain.gain.value = 1;
        }
        this.WarnedWebAudioUnsupported = false;
        this._hideMuteButton();
        window.removeEventListener("resize", this._onResize);

        this.onAudioUnlockedObservable.clear();
        this.onAudioLockedObservable.clear();

        // close is async.
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        this._audioContext?.close();
        this._audioContext = null;
    }

    /**
     * Gets the global volume sets on the master gain.
     * @returns the global volume if set or -1 otherwise
     */
    public getGlobalVolume(): number {
        if (this.canUseWebAudio && this._audioContextInitialized) {
            return this.masterGain.gain.value;
        } else {
            return -1;
        }
    }

    /**
     * Sets the global volume of your experience (sets on the master gain).
     * @param newVolume Defines the new global volume of the application
     */
    public setGlobalVolume(newVolume: number): void {
        if (this.canUseWebAudio && this._audioContextInitialized) {
            this.masterGain.gain.value = newVolume;
        }
    }

    /**
     * Connect the audio engine to an audio analyser allowing some amazing
     * synchronization between the sounds/music and your visualization (VuMeter for instance).
     * @see https://doc.babylonjs.com/features/featuresDeepDive/audio/playingSoundsMusic#using-the-analyser
     * @param analyser The analyser to connect to the engine
     */
    public connectToAnalyser(analyser: Analyser): void {
        if (this._connectedAnalyser) {
            this._connectedAnalyser.stopDebugCanvas();
        }
        if (this.canUseWebAudio && this._audioContextInitialized && this._audioContext) {
            this._connectedAnalyser = analyser;
            this.masterGain.disconnect();
            this._connectedAnalyser.connectAudioNodes(this.masterGain, this._audioContext.destination);
        }
    }
}
