import "@gpuix/react/globals"

const adapterRequest = navigator.gpu.requestAdapter().then(adapter => adapter.requestDevice())
const vertexUsage: number = GPUBufferUsage.VERTEX
const isValidationError: boolean = new Error() instanceof GPUValidationError
const uncapturedEvent = new GPUUncapturedErrorEvent("uncapturederror", {
  error: new GPUValidationError("invalid buffer"),
})

const device = await (await navigator.gpu.requestAdapter()).requestDevice()
device.onuncapturederror = event => {
  const error: GPUError = event.error
  void error
}

void adapterRequest
void vertexUsage
void isValidationError
void uncapturedEvent
