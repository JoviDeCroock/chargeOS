import { render } from "preact";

import "./style.css";

const root = document.getElementById("app");
if (!root) throw new Error("Missing #app mount point");

if (/^\/preview\/?$/.test(window.location.pathname)) {
  void import("./product/app.js").then(({ ProductPreview }) => render(<ProductPreview />, root));
} else if (/^\/observe\/?$/.test(window.location.pathname)) {
  void import("./observation/app.js").then(({ ObservationWorkspace }) =>
    render(<ObservationWorkspace />, root),
  );
} else {
  void import("./app.js").then(({ App }) => render(<App />, root));
}
