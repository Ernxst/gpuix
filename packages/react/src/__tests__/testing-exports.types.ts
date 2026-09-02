import { getDefaultNormalizer, type NormalizerFn, type NormalizerOptions } from "../testing.js"

// `getDefaultNormalizer` is public, so the shape of its argument has to be too:
// a wrapper that forwards a caller's trim/collapseWhitespace choice cannot be
// written without naming the type.
function normalizerFrom(options: NormalizerOptions): NormalizerFn {
  return getDefaultNormalizer(options)
}

export const shoutingNormalizer: NormalizerFn = (content) =>
  normalizerFrom({ collapseWhitespace: false })(content).toUpperCase()
