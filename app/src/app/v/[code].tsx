// A shared link, https://www.reprizeapp.com/v/<code>, for a whole recording or a single clip (sharing design §7): the
// server knows which. Phase 0 placeholder: proves the Universal Link opens the app on this route. Phase 1 replaces it
// with the received recording.
import SharedLinkPlaceholder from '../../share/SharedLinkPlaceholder';

export default function SharedLink() {
  return <SharedLinkPlaceholder />;
}
