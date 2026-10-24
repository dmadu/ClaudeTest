export const TEXT_LIMIT = 200
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const IMAGE_TYPES = ['image/jpeg', 'image/png']

const NUMBER_RE = /^-?\d+(\.\d+)?$/

function checkText(value, errors, name) {
  const v = value.trim()
  if (!v) errors[name] = 'This field is required.'
  else if (v.length > TEXT_LIMIT) errors[name] = `Must be at most ${TEXT_LIMIT} characters.`
}

function checkCoordinate(value, limit, errors, name) {
  const v = value.trim()
  if (!v) errors[name] = 'This field is required.'
  else if (!NUMBER_RE.test(v)) errors[name] = 'Enter a number, for example -35.2809.'
  else if (Math.abs(Number(v)) > limit) errors[name] = `Must be between -${limit} and ${limit}.`
}

export function validateImage(file) {
  if (!IMAGE_TYPES.includes(file.type)) return 'Image must be a JPEG or PNG file.'
  if (file.size === 0) return 'The image file is empty.'
  if (file.size > MAX_IMAGE_BYTES) return 'Image must be 5 MB or smaller.'
  return null
}

/** Returns an object of field errors. Empty means valid. The server repeats every check. */
export function validateRecord(values, file, { imageRequired }) {
  const errors = {}
  checkText(values.title, errors, 'title')
  checkText(values.site, errors, 'site')
  checkCoordinate(values.latitude, 90, errors, 'latitude')
  checkCoordinate(values.longitude, 180, errors, 'longitude')
  if (file) {
    const problem = validateImage(file)
    if (problem) errors.image = problem
  } else if (imageRequired) {
    errors.image = 'This field is required.'
  }
  return errors
}
