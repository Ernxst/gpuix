declare module "*.module.css" {
  // A web build resolves these to class names, and `className` is where both
  // builds put them. A GPUIX build compiles the file to native styles instead,
  // so the value is only ever passed along, never read as text. Typing it as a
  // string keeps one component compiling against react-dom and GPUIX alike,
  // and keeps an inline style object out of `className`.
  const styles: Record<string, string>
  export default styles
}
