import type { SdkRuntime } from './smartspectra-service'

/**
 * Loads the real @smartspectra/node-sdk (main-process, native camera capture).
 * Imported lazily so an unsupported platform yields a typed error state instead
 * of crashing at startup.
 */
export const loadSdkRuntime = async (): Promise<SdkRuntime> => {
  const sdk = await import('@smartspectra/node-sdk')
  const messages = await import('@smartspectra/node-sdk/messages')

  return {
    version: sdk.SmartSpectraSDK.version,
    create({ apiKey }) {
      const instance = new sdk.SmartSpectraSDK({
        apiKey,
        requestedMetrics: [...sdk.breathingMetrics, ...sdk.cardioMetrics],
        // Opt out of the SDK's optional aggregate usage telemetry (default is on).
        enableTelemetry: false
      })
      // The SDK's `on` is overloaded per event; the service's SdkInstance type
      // re-declares the same four signatures, so a loosely typed handle is enough here.
      const emitter = instance as unknown as { on(event: string, cb: unknown): unknown }
      return {
        on: (event: string, cb: unknown) => emitter.on(event, cb),
        useCameraDefault: () => instance.useCamera(sdk.CameraSelection.default),
        start: () => instance.start(),
        stopAsync: () => instance.stopAsync(),
        reset: () => instance.reset(),
        destroy: () => instance.destroy()
      } as ReturnType<SdkRuntime['create']>
    },
    // /messages decodeMetrics returns the decoded Metrics object. (The root export
    // returns the raw Buffer unless setMetricsClass() is called.)
    decodeMetrics: (buf) => messages.decodeMetrics(buf)
  }
}
