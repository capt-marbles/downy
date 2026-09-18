# Downy on iPhone

In Safari, sign in through Cloudflare Access, open Downy, then Share → Add to Home Screen.
The manifest uses `display: standalone`, `scope: /`, and `start_url: /`. The root
route selects the first active agent after authentication; it does not bake a
machine-specific agent slug into the installation. The manifest link includes
`crossorigin="use-credentials"` so an authenticated manifest request carries cookies.
There is no service worker or offline cache. Access still protects every route.

The icon uses Downy's warm amber and teal accents on its light background.
`downy-icon.svg` is the editable source for the 192px and 512px PNGs.

Source review confirms the launch route passes through the existing Access gate.
Physical Safari installation, cookie persistence in standalone mode, and an
expired-session reauthentication must be checked on the operator's iPhone after
deployment. This change does not claim live device verification.
