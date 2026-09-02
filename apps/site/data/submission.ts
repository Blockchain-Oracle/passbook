import manifest from '../../../strk20.json'

/** The public demo and evidence counts come from the submission manifest, not landing-page copy. */
export const DEMO_VIDEO_URL = manifest.demo_video
export const SUBMISSION_TRANSACTION_COUNT = manifest.transactions.length
export const SUBMISSION_CONTRACT_COUNT = manifest.contracts.length

const vimeoId = new URL(DEMO_VIDEO_URL).pathname.split('/').filter(Boolean).at(-1)

if (!vimeoId) throw new Error(`Cannot read Vimeo id from ${DEMO_VIDEO_URL}`)

/** Vimeo's privacy-aware player URL. Playback remains user initiated. */
export const DEMO_EMBED_URL = `https://player.vimeo.com/video/${vimeoId}?dnt=1&title=0&byline=0&portrait=0`
