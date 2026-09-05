import manifest from '../../../strk20.json'

/** The public demo and evidence counts come from the submission manifest, not landing-page copy. */
export const DEMO_VIDEO_URL = manifest.demo_video
export const SUBMISSION_TRANSACTION_COUNT = manifest.transactions.length
export const SUBMISSION_CONTRACT_COUNT = manifest.contracts.length

const videoUrl = new URL(DEMO_VIDEO_URL)
const youtubeId = videoUrl.hostname === 'youtu.be'
  ? videoUrl.pathname.slice(1)
  : videoUrl.searchParams.get('v')

if (!youtubeId || !/^[\w-]{11}$/.test(youtubeId)) {
  throw new Error(`Cannot read YouTube id from ${DEMO_VIDEO_URL}`)
}

// Use YouTube's privacy-enhanced player without autoplay.
export const DEMO_EMBED_URL = `https://www.youtube-nocookie.com/embed/${youtubeId}`
