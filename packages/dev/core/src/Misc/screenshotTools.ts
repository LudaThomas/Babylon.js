/* eslint-disable @typescript-eslint/naming-convention */
import type { Camera } from "../Cameras/camera";
import { Texture } from "../Materials/Textures/texture";
import { RenderTargetTexture } from "../Materials/Textures/renderTargetTexture";
import { FxaaPostProcess } from "../PostProcesses/fxaaPostProcess";
import { Constants } from "../Engines/constants";
import { Logger } from "./logger";
import { Tools } from "./tools";
import type { IScreenshotSize } from "./interfaces/screenshotSize";
import { DumpData } from "./dumpTools";
import type { Nullable } from "../types";
import { ApplyPostProcess } from "./textureTools";

import type { AbstractEngine } from "../Engines/abstractEngine";
import { _RetryWithInterval } from "./timingTools";

let screenshotCanvas: Nullable<HTMLCanvasElement> = null;

/**
 * Captures a screenshot of the current rendering
 * @see https://doc.babylonjs.com/features/featuresDeepDive/scene/renderToPNG
 * @param engine defines the rendering engine
 * @param camera defines the source camera. If the camera is not the scene's active camera, {@link CreateScreenshotUsingRenderTarget} will be used instead, and `useFill` will be ignored
 * @param size This parameter can be set to a single number or to an object with the
 * following (optional) properties: precision, width, height. If a single number is passed,
 * it will be used for both width and height. If an object is passed, the screenshot size
 * will be derived from the parameters. The precision property is a multiplier allowing
 * rendering at a higher or lower resolution
 * @param successCallback defines the callback receives a single parameter which contains the
 * screenshot as a string of base64-encoded characters. This string can be assigned to the
 * src parameter of an <img> to display it
 * @param mimeType defines the MIME type of the screenshot image (default: image/png).
 * Check your browser for supported MIME types
 * @param forceDownload force the system to download the image even if a successCallback is provided
 * @param quality The quality of the image if lossy mimeType is used (e.g. image/jpeg, image/webp). See {@link https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob | HTMLCanvasElement.toBlob()}'s `quality` parameter.
 * @param useFill fill the screenshot dimensions with the render canvas and clip any overflow. If false, fit the canvas within the screenshot, as in letterboxing.
 */
export function CreateScreenshot(
    engine: AbstractEngine,
    camera: Camera,
    size: IScreenshotSize | number,
    successCallback?: (data: string) => void,
    mimeType = "image/png",
    forceDownload = false,
    quality?: number,
    useFill = false
): void {
    const { height, width } = GetScreenshotSize(engine, camera, size);

    if (!(height && width)) {
        Logger.Error("Invalid 'size' parameter !");
        return;
    }

    const scene = camera.getScene();
    if (scene.activeCamera !== camera) {
        CreateScreenshotUsingRenderTarget(
            engine,
            camera,
            size,
            (data) => {
                if (forceDownload) {
                    const blob = new Blob([data]);
                    Tools.DownloadBlob(blob);
                    if (successCallback) {
                        successCallback("");
                    }
                } else if (successCallback) {
                    successCallback(data);
                }
            },
            mimeType,
            1.0,
            engine.getCreationOptions().antialias,
            undefined,
            undefined,
            undefined,
            undefined,
            quality
        );
        return;
    }

    engine.onEndFrameObservable.addOnce(() => {
        if (!screenshotCanvas) {
            screenshotCanvas = document.createElement("canvas");
        }
        screenshotCanvas.width = width;
        screenshotCanvas.height = height;

        const renderContext = screenshotCanvas.getContext("2d");
        const renderingCanvas = engine.getRenderingCanvas();
        if (!renderContext || !renderingCanvas) {
            Logger.Error("Failed to create screenshot. Rendering context or rendering canvas is not available.");
            return;
        }

        const srcWidth = renderingCanvas.width;
        const srcHeight = renderingCanvas.height;
        const destWidth = screenshotCanvas.width;
        const destHeight = screenshotCanvas.height;

        // Calculate scale factors for width and height.
        const scaleX = destWidth / srcWidth;
        const scaleY = destHeight / srcHeight;
        // Use the larger of the two scales to fill the screenshot dimensions, else use the smaller to fit.
        const scale = useFill ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);
        const newWidth = srcWidth * scale;
        const newHeight = srcHeight * scale;

        // Center the image in the screenshot canvas
        const offsetX = (destWidth - newWidth) / 2;
        const offsetY = (destHeight - newHeight) / 2;

        renderContext.drawImage(renderingCanvas, 0, 0, srcWidth, srcHeight, offsetX, offsetY, newWidth, newHeight);

        if (forceDownload) {
            Tools.EncodeScreenshotCanvasData(screenshotCanvas, undefined, mimeType, undefined, quality);
            if (successCallback) {
                successCallback("");
            }
        } else {
            Tools.EncodeScreenshotCanvasData(screenshotCanvas, successCallback, mimeType, undefined, quality);
        }
    });
}

/**
 * Captures a screenshot of the current rendering
 * @see https://doc.babylonjs.com/features/featuresDeepDive/scene/renderToPNG
 * @param engine defines the rendering engine
 * @param camera defines the source camera. If the camera is not the scene's active camera, {@link CreateScreenshotUsingRenderTarget} will be used instead, and `useFill` will be ignored
 * @param size This parameter can be set to a single number or to an object with the
 * following (optional) properties: precision, width, height. If a single number is passed,
 * it will be used for both width and height. If an object is passed, the screenshot size
 * will be derived from the parameters. The precision property is a multiplier allowing
 * rendering at a higher or lower resolution
 * @param mimeType defines the MIME type of the screenshot image (default: image/png).
 * Check your browser for supported MIME types
 * @param quality The quality of the image if lossy mimeType is used (e.g. image/jpeg, image/webp). See {@link https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob | HTMLCanvasElement.toBlob()}'s `quality` parameter.
 * @param useFill fill the screenshot dimensions with the render canvas and clip any overflow. If false, fit the canvas within the screenshot, as in letterboxing.
 * @returns screenshot as a string of base64-encoded characters. This string can be assigned
 * to the src parameter of an <img> to display it
 */
export async function CreateScreenshotAsync(
    engine: AbstractEngine,
    camera: Camera,
    size: IScreenshotSize | number,
    mimeType = "image/png",
    quality?: number,
    useFill = false
): Promise<string> {
    return await new Promise((resolve, reject) => {
        CreateScreenshot(
            engine,
            camera,
            size,
            (data) => {
                if (typeof data !== "undefined") {
                    resolve(data);
                } else {
                    reject(new Error("Data is undefined"));
                }
            },
            mimeType,
            undefined,
            quality,
            useFill
        );
    });
}

/**
 * Captures and automatically downloads a screenshot of the current rendering for a specific size. This will render the entire canvas but will generate a blink (due to canvas resize)
 * If screenshot image data is needed, use {@link CreateScreenshotAsync} instead.
 * @see https://doc.babylonjs.com/features/featuresDeepDive/scene/renderToPNG
 * @param engine defines the rendering engine
 * @param camera defines the source camera. If the camera is not the scene's active camera, {@link CreateScreenshotUsingRenderTarget} will be used instead, and `useFill` will be ignored
 * @param width defines the expected width
 * @param height defines the expected height
 * @param mimeType defines the MIME type of the screenshot image (default: image/png).
 * Check your browser for supported MIME types
 * @param quality The quality of the image if lossy mimeType is used (e.g. image/jpeg, image/webp). See {@link https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob | HTMLCanvasElement.toBlob()}'s `quality` parameter.
 * @param useFill fill the screenshot dimensions with the render canvas and clip any overflow. If false, fit the canvas within the screenshot, as in letterboxing.
 * @returns promise that resolves once the screenshot is taken
 */
export async function CreateScreenshotWithResizeAsync(
    engine: AbstractEngine,
    camera: Camera,
    width: number,
    height: number,
    mimeType = "image/png",
    quality?: number,
    useFill = false
): Promise<void> {
    return await new Promise((resolve) => {
        CreateScreenshot(
            engine,
            camera,
            { width: width, height: height },
            () => {
                resolve();
            },
            mimeType,
            true,
            quality,
            useFill
        );
    });
}

/**
 * Generates an image screenshot from the specified camera.
 * @see https://doc.babylonjs.com/features/featuresDeepDive/scene/renderToPNG
 * @param engine The engine to use for rendering
 * @param camera The camera to use for rendering
 * @param size This parameter can be set to a single number or to an object with the
 * following (optional) properties: precision, width, height, finalWidth, finalHeight. If a single number is passed,
 * it will be used for both width and height, as well as finalWidth, finalHeight. If an object is passed, the screenshot size
 * will be derived from the parameters. The precision property is a multiplier allowing
 * rendering at a higher or lower resolution
 * @param successCallback The callback receives a single parameter which contains the
 * screenshot as a string of base64-encoded characters. This string can be assigned to the
 * src parameter of an <img> to display it
 * @param mimeType The MIME type of the screenshot image (default: image/png).
 * Check your browser for supported MIME types
 * @param samples Texture samples (default: 1)
 * @param antialiasing Whether antialiasing should be turned on or not (default: false)
 * @param fileName A name for for the downloaded file.
 * @param renderSprites Whether the sprites should be rendered or not (default: false)
 * @param enableStencilBuffer Whether the stencil buffer should be enabled or not (default: false)
 * @param useLayerMask if the camera's layer mask should be used to filter what should be rendered (default: true)
 * @param quality The quality of the image if lossy mimeType is used (e.g. image/jpeg, image/webp). See {@link https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob | HTMLCanvasElement.toBlob()}'s `quality` parameter.
 * @param customizeTexture An optional callback that can be used to modify the render target texture before taking the screenshot. This can be used, for instance, to enable camera post-processes before taking the screenshot.
 * @param customDumpData The function to use to dump the data. If not provided, the default DumpData function will be used.
 */
export function CreateScreenshotUsingRenderTarget(
    engine: AbstractEngine,
    camera: Camera,
    size: IScreenshotSize | number,
    successCallback?: (data: string) => void,
    mimeType = "image/png",
    samples = 1,
    antialiasing = false,
    fileName?: string,
    renderSprites = false,
    enableStencilBuffer = false,
    useLayerMask = true,
    quality?: number,
    customizeTexture?: (texture: RenderTargetTexture) => void,
    customDumpData?: (
        width: number,
        height: number,
        data: ArrayBufferView,
        successCallback?: (data: string | ArrayBuffer) => void,
        mimeType?: string,
        fileName?: string,
        invertY?: boolean,
        toArrayBuffer?: boolean,
        quality?: number
    ) => void
): void {
    const { height, width, finalWidth, finalHeight } = GetScreenshotSize(engine, camera, size);
    const targetTextureSize = { width, height };

    if (!(height && width)) {
        Logger.Error("Invalid 'size' parameter !");
        return;
    }

    // Prevent engine to render on screen while we do the screenshot
    engine.skipFrameRender = true;

    const originalGetRenderWidth = engine.getRenderWidth;
    const originalGetRenderHeight = engine.getRenderHeight;

    // Override getRenderWidth and getRenderHeight to return the desired size of the render
    // A few internal methods are relying on the canvas size to compute the render size
    // so we need to override these methods to ensure the correct size is used during the preparation of the render
    // as well as the screenshot
    engine.getRenderWidth = (useScreen = false) => {
        if (!useScreen && engine._currentRenderTarget) {
            return engine._currentRenderTarget.width;
        }

        return width;
    };
    engine.getRenderHeight = (useScreen = false) => {
        if (!useScreen && engine._currentRenderTarget) {
            return engine._currentRenderTarget.height;
        }

        return height;
    };

    // Trigger a resize event to ensure the intermediate renders have the correct size
    if (engine.onResizeObservable.hasObservers()) {
        engine.onResizeObservable.notifyObservers(engine);
    }

    const scene = camera.getScene();

    // At this point size can be a number, or an object (according to engine.prototype.createRenderTargetTexture method)
    const texture = new RenderTargetTexture(
        "screenShot",
        targetTextureSize,
        scene,
        false,
        false,
        Constants.TEXTURETYPE_UNSIGNED_BYTE,
        false,
        Texture.BILINEAR_SAMPLINGMODE,
        undefined,
        enableStencilBuffer,
        undefined,
        undefined,
        undefined,
        samples
    );
    texture.renderList = scene.meshes.slice();
    texture.samples = samples;
    texture.renderSprites = renderSprites;
    texture.activeCamera = camera;
    texture.forceLayerMaskCheck = useLayerMask;
    customizeTexture?.(texture);

    const dumpDataFunc = customDumpData || DumpData;

    const renderWhenReady = () => {
        _RetryWithInterval(
            () => texture.isReadyForRendering() && camera.isReady(true),
            () => {
                engine.onEndFrameObservable.addOnce(() => {
                    if (finalWidth === width && finalHeight === height) {
                        // eslint-disable-next-line @typescript-eslint/no-floating-promises, github/no-then
                        texture.readPixels(undefined, undefined, undefined, false)!.then((data) => {
                            dumpDataFunc(width, height, data, successCallback as (data: string | ArrayBuffer) => void, mimeType, fileName, true, undefined, quality);
                            texture.dispose();
                        });
                    } else {
                        const importPromise = engine.isWebGPU ? import("../ShadersWGSL/pass.fragment") : import("../Shaders/pass.fragment");
                        // eslint-disable-next-line @typescript-eslint/no-floating-promises, github/no-then
                        importPromise.then(
                            async () =>
                                // eslint-disable-next-line github/no-then
                                await ApplyPostProcess("pass", texture.getInternalTexture()!, scene, undefined, undefined, undefined, finalWidth, finalHeight).then((texture) => {
                                    // eslint-disable-next-line @typescript-eslint/no-floating-promises, github/no-then
                                    engine._readTexturePixels(texture, finalWidth, finalHeight, -1, 0, null, true, false, 0, 0).then((data) => {
                                        dumpDataFunc(
                                            finalWidth,
                                            finalHeight,
                                            data,
                                            successCallback as (data: string | ArrayBuffer) => void,
                                            mimeType,
                                            fileName,
                                            true,
                                            undefined,
                                            quality
                                        );
                                        texture.dispose();
                                    });
                                })
                        );
                    }
                });
                scene.incrementRenderId();
                scene.resetCachedMaterial();

                // Record the original scene setup
                const originalCamera = scene.activeCamera;
                const originalCameras = scene.activeCameras;
                const originalOutputRenderTarget = camera.outputRenderTarget;
                const originalSpritesEnabled = scene.spritesEnabled;

                // Swap with the requested one
                scene.activeCamera = camera;
                scene.activeCameras = null;
                camera.outputRenderTarget = texture;
                scene.spritesEnabled = renderSprites;

                const currentMeshList = scene.meshes;
                scene.meshes = texture.renderList || scene.meshes;

                // render the scene on the RTT
                try {
                    scene.render();
                } finally {
                    // Restore the original scene camera setup
                    scene.activeCamera = originalCamera;
                    scene.activeCameras = originalCameras;
                    camera.outputRenderTarget = originalOutputRenderTarget;
                    scene.spritesEnabled = originalSpritesEnabled;
                    scene.meshes = currentMeshList;

                    engine.getRenderWidth = originalGetRenderWidth;
                    engine.getRenderHeight = originalGetRenderHeight;

                    // Trigger a resize event to ensure the intermediate renders have the correct size
                    if (engine.onResizeObservable.hasObservers()) {
                        engine.onResizeObservable.notifyObservers(engine);
                    }

                    camera.getProjectionMatrix(true); // Force cache refresh;

                    engine.skipFrameRender = false;
                }
            },
            () => {
                // Restore engine frame rendering on error
                engine.skipFrameRender = false;
                engine.getRenderWidth = originalGetRenderWidth;
                engine.getRenderHeight = originalGetRenderHeight;
            }
        );
    };

    const renderToTexture = () => {
        // render the RTT
        scene.incrementRenderId();
        scene.resetCachedMaterial();

        renderWhenReady();
    };

    if (antialiasing) {
        const fxaaPostProcess = new FxaaPostProcess("antialiasing", 1.0, scene.activeCamera);
        texture.addPostProcess(fxaaPostProcess);
        // Ensures the correct background color is used
        fxaaPostProcess.autoClear = true;

        // Async Shader Compilation can lead to none ready effects in synchronous code
        fxaaPostProcess.onEffectCreatedObservable.addOnce((e) => {
            if (!e.isReady()) {
                e.onCompiled = () => {
                    renderToTexture();
                };
            }
            // The effect is ready we can render
            else {
                renderToTexture();
            }
        });
    } else {
        // No need to wait for extra resources to be ready
        renderToTexture();
    }
}

/**
 * Generates an image screenshot from the specified camera.
 * @see https://doc.babylonjs.com/features/featuresDeepDive/scene/renderToPNG
 * @param engine The engine to use for rendering
 * @param camera The camera to use for rendering
 * @param size This parameter can be set to a single number or to an object with the
 * following (optional) properties: precision, width, height. If a single number is passed,
 * it will be used for both width and height. If an object is passed, the screenshot size
 * will be derived from the parameters. The precision property is a multiplier allowing
 * rendering at a higher or lower resolution
 * @param mimeType The MIME type of the screenshot image (default: image/png).
 * Check your browser for supported MIME types
 * @param samples Texture samples (default: 1)
 * @param antialiasing Whether antialiasing should be turned on or not (default: false)
 * @param fileName A name for for the downloaded file.
 * @param renderSprites Whether the sprites should be rendered or not (default: false)
 * @param enableStencilBuffer Whether the stencil buffer should be enabled or not (default: false)
 * @param useLayerMask if the camera's layer mask should be used to filter what should be rendered (default: true)
 * @param quality The quality of the image if lossy mimeType is used (e.g. image/jpeg, image/webp). See {@link https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob | HTMLCanvasElement.toBlob()}'s `quality` parameter.
 * @param customizeTexture An optional callback that can be used to modify the render target texture before taking the screenshot. This can be used, for instance, to enable camera post-processes before taking the screenshot.
 * @param customDumpData The function to use to dump the data. If not provided, the default DumpData function will be used.
 * @returns screenshot as a string of base64-encoded characters. This string can be assigned
 * to the src parameter of an <img> to display it
 */
export async function CreateScreenshotUsingRenderTargetAsync(
    engine: AbstractEngine,
    camera: Camera,
    size: IScreenshotSize | number,
    mimeType = "image/png",
    samples = 1,
    antialiasing = false,
    fileName?: string,
    renderSprites = false,
    enableStencilBuffer = false,
    useLayerMask = true,
    quality?: number,
    customizeTexture?: (texture: RenderTargetTexture) => void,
    customDumpData?: (
        width: number,
        height: number,
        data: ArrayBufferView,
        successCallback?: (data: string | ArrayBuffer) => void,
        mimeType?: string,
        fileName?: string,
        invertY?: boolean,
        toArrayBuffer?: boolean,
        quality?: number
    ) => void
): Promise<string> {
    return await new Promise((resolve, reject) => {
        CreateScreenshotUsingRenderTarget(
            engine,
            camera,
            size,
            (data) => {
                if (typeof data !== "undefined") {
                    resolve(data);
                } else {
                    reject(new Error("Data is undefined"));
                }
            },
            mimeType,
            samples,
            antialiasing,
            fileName,
            renderSprites,
            enableStencilBuffer,
            useLayerMask,
            quality,
            customizeTexture,
            customDumpData
        );
    });
}

/**
 * Gets height and width for screenshot size
 * @param engine The engine to use for rendering
 * @param camera The camera to use for rendering
 * @param size This size of the screenshot. can be a number or an object implementing IScreenshotSize
 * @returns height and width for screenshot size
 */
function GetScreenshotSize(engine: AbstractEngine, camera: Camera, size: IScreenshotSize | number): { height: number; width: number; finalWidth: number; finalHeight: number } {
    let height = 0;
    let width = 0;
    let finalWidth = 0;
    let finalHeight = 0;

    //If a size value defined as object
    if (typeof size === "object") {
        const precision = size.precision
            ? Math.abs(size.precision) // prevent GL_INVALID_VALUE : glViewport: negative width/height
            : 1;

        //If a width and height values is specified
        if (size.width && size.height) {
            height = size.height * precision;
            width = size.width * precision;
        }
        //If passing only width, computing height to keep display canvas ratio.
        else if (size.width && !size.height) {
            width = size.width * precision;
            height = Math.round(width / engine.getAspectRatio(camera));
        }
        //If passing only height, computing width to keep display canvas ratio.
        else if (size.height && !size.width) {
            height = size.height * precision;
            width = Math.round(height * engine.getAspectRatio(camera));
        } else {
            width = Math.round(engine.getRenderWidth() * precision);
            height = Math.round(width / engine.getAspectRatio(camera));
        }

        //If a finalWidth and finalHeight values is specified
        if (size.finalWidth && size.finalHeight) {
            finalHeight = size.finalHeight;
            finalWidth = size.finalWidth;
        }
        //If passing only finalWidth, computing finalHeight to keep display canvas ratio.
        else if (size.finalWidth && !size.finalHeight) {
            finalWidth = size.finalWidth;
            finalHeight = Math.round(finalWidth / engine.getAspectRatio(camera));
        }
        //If passing only finalHeight, computing finalWidth to keep display canvas ratio.
        else if (size.finalHeight && !size.finalWidth) {
            finalHeight = size.finalHeight;
            finalWidth = Math.round(finalHeight * engine.getAspectRatio(camera));
        } else {
            finalWidth = width;
            finalHeight = height;
        }
    }
    //Assuming here that "size" parameter is a number
    else if (!isNaN(size)) {
        height = size;
        width = size;
        finalWidth = size;
        finalHeight = size;
    }

    // When creating the image data from the CanvasRenderingContext2D, the width and height is clamped to the size of the _gl context
    // On certain GPUs, it seems as if the _gl context truncates to an integer automatically. Therefore, if a user tries to pass the width of their canvas element
    // and it happens to be a float (1000.5 x 600.5 px), the engine.readPixels will return a different size array than context.createImageData
    // to resolve this, we truncate the floats here to ensure the same size
    if (width) {
        width = Math.floor(width);
    }
    if (height) {
        height = Math.floor(height);
    }
    if (finalWidth) {
        finalWidth = Math.floor(finalWidth);
    }
    if (finalHeight) {
        finalHeight = Math.floor(finalHeight);
    }

    return { height: height | 0, width: width | 0, finalWidth: finalWidth | 0, finalHeight: finalHeight | 0 };
}

/**
 * Class containing a set of static utilities functions for screenshots
 */
export const ScreenshotTools = {
    /**
     * Captures a screenshot of the current rendering
     * @see https://doc.babylonjs.com/features/featuresDeepDive/scene/renderToPNG
     * @param engine defines the rendering engine
     * @param camera defines the source camera. If the camera is not the scene's active camera, {@link CreateScreenshotUsingRenderTarget} will be used instead, and `useFill` will be ignored
     * @param size This parameter can be set to a single number or to an object with the
     * following (optional) properties: precision, width, height. If a single number is passed,
     * it will be used for both width and height. If an object is passed, the screenshot size
     * will be derived from the parameters. The precision property is a multiplier allowing
     * rendering at a higher or lower resolution
     * @param successCallback defines the callback receives a single parameter which contains the
     * screenshot as a string of base64-encoded characters. This string can be assigned to the
     * src parameter of an <img> to display it
     * @param mimeType defines the MIME type of the screenshot image (default: image/png).
     * Check your browser for supported MIME types
     * @param forceDownload force the system to download the image even if a successCallback is provided
     * @param quality The quality of the image if lossy mimeType is used (e.g. image/jpeg, image/webp). See {@link https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob | HTMLCanvasElement.toBlob()}'s `quality` parameter.
     * @param useFill fill the screenshot dimensions with the render canvas and clip any overflow. If false, fit the canvas within the screenshot, as in letterboxing.
     */
    CreateScreenshot,

    /**
     * Captures a screenshot of the current rendering
     * @see https://doc.babylonjs.com/features/featuresDeepDive/scene/renderToPNG
     * @param engine defines the rendering engine
     * @param camera defines the source camera. If the camera is not the scene's active camera, {@link CreateScreenshotUsingRenderTarget} will be used instead, and `useFill` will be ignored
     * @param size This parameter can be set to a single number or to an object with the
     * following (optional) properties: precision, width, height. If a single number is passed,
     * it will be used for both width and height. If an object is passed, the screenshot size
     * will be derived from the parameters. The precision property is a multiplier allowing
     * rendering at a higher or lower resolution
     * @param mimeType defines the MIME type of the screenshot image (default: image/png).
     * Check your browser for supported MIME types
     * @param quality The quality of the image if lossy mimeType is used (e.g. image/jpeg, image/webp). See {@link https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob | HTMLCanvasElement.toBlob()}'s `quality` parameter.
     * @param useFill fill the screenshot dimensions with the render canvas and clip any overflow. If false, fit the canvas within the screenshot, as in letterboxing.
     * @returns screenshot as a string of base64-encoded characters. This string can be assigned
     * to the src parameter of an <img> to display it
     */
    CreateScreenshotAsync,

    /**
     * Captures and automatically downloads a screenshot of the current rendering for a specific size. This will render the entire canvas but will generate a blink (due to canvas resize)
     * If screenshot image data is needed, use {@link CreateScreenshotAsync} instead.
     * @see https://doc.babylonjs.com/features/featuresDeepDive/scene/renderToPNG
     * @param engine defines the rendering engine
     * @param camera defines the source camera. If the camera is not the scene's active camera, {@link CreateScreenshotUsingRenderTarget} will be used instead, and `useFill` will be ignored
     * @param width defines the expected width
     * @param height defines the expected height
     * @param mimeType defines the MIME type of the screenshot image (default: image/png).
     * Check your browser for supported MIME types
     * @param quality The quality of the image if lossy mimeType is used (e.g. image/jpeg, image/webp). See {@link https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob | HTMLCanvasElement.toBlob()}'s `quality` parameter.
     * @param useFill fill the screenshot dimensions with the render canvas and clip any overflow. If false, fit the canvas within the screenshot, as in letterboxing.
     * @returns promise that resolves once the screenshot is taken
     */
    CreateScreenshotWithResizeAsync,

    /**
     * Generates an image screenshot from the specified camera.
     * @see https://doc.babylonjs.com/features/featuresDeepDive/scene/renderToPNG
     * @param engine The engine to use for rendering
     * @param camera The camera to use for rendering
     * @param size This parameter can be set to a single number or to an object with the
     * following (optional) properties: precision, width, height. If a single number is passed,
     * it will be used for both width and height. If an object is passed, the screenshot size
     * will be derived from the parameters. The precision property is a multiplier allowing
     * rendering at a higher or lower resolution
     * @param successCallback The callback receives a single parameter which contains the
     * screenshot as a string of base64-encoded characters. This string can be assigned to the
     * src parameter of an <img> to display it
     * @param mimeType The MIME type of the screenshot image (default: image/png).
     * Check your browser for supported MIME types
     * @param samples Texture samples (default: 1)
     * @param antialiasing Whether antialiasing should be turned on or not (default: false)
     * @param fileName A name for for the downloaded file.
     * @param renderSprites Whether the sprites should be rendered or not (default: false)
     * @param enableStencilBuffer Whether the stencil buffer should be enabled or not (default: false)
     * @param quality The quality of the image if lossy mimeType is used (e.g. image/jpeg, image/webp). See {@link https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob | HTMLCanvasElement.toBlob()}'s `quality` parameter.
     */
    CreateScreenshotUsingRenderTarget,

    /**
     * Generates an image screenshot from the specified camera.
     * @see https://doc.babylonjs.com/features/featuresDeepDive/scene/renderToPNG
     * @param engine The engine to use for rendering
     * @param camera The camera to use for rendering
     * @param size This parameter can be set to a single number or to an object with the
     * following (optional) properties: precision, width, height. If a single number is passed,
     * it will be used for both width and height. If an object is passed, the screenshot size
     * will be derived from the parameters. The precision property is a multiplier allowing
     * rendering at a higher or lower resolution
     * @param mimeType The MIME type of the screenshot image (default: image/png).
     * Check your browser for supported MIME types
     * @param samples Texture samples (default: 1)
     * @param antialiasing Whether antialiasing should be turned on or not (default: false)
     * @param fileName A name for for the downloaded file.
     * @param renderSprites Whether the sprites should be rendered or not (default: false)
     * @param quality The quality of the image if lossy mimeType is used (e.g. image/jpeg, image/webp). See {@link https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob | HTMLCanvasElement.toBlob()}'s `quality` parameter.
     * @returns screenshot as a string of base64-encoded characters. This string can be assigned
     * to the src parameter of an <img> to display it
     */
    CreateScreenshotUsingRenderTargetAsync,
};

/**
 * This will be executed automatically for UMD and es5.
 * If esm dev wants the side effects to execute they will have to run it manually
 * Once we build native modules those need to be exported.
 * @internal
 */
const initSideEffects = () => {
    // References the dependencies.
    Tools.CreateScreenshot = CreateScreenshot;
    Tools.CreateScreenshotAsync = CreateScreenshotAsync;
    Tools.CreateScreenshotUsingRenderTarget = CreateScreenshotUsingRenderTarget;
    Tools.CreateScreenshotUsingRenderTargetAsync = CreateScreenshotUsingRenderTargetAsync;
};

initSideEffects();
