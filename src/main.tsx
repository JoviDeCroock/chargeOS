import { render } from "preact";

import "./style.css";

const root = document.getElementById("app");
if (!root) throw new Error("Missing #app mount point");

const hostedPage = document.documentElement.dataset.commercialHosting === "production";

if (/^\/help\/?$/.test(window.location.pathname)) {
  void import("./help.js").then(({ HelpWorkspace }) =>
    render(<HelpWorkspace hostedPage={hostedPage} />, root),
  );
} else if (/^\/service\/recovery\/?$/.test(window.location.pathname)) {
  void import("./service/recovery.js").then(({ RecoveryEnrollmentWorkspace }) =>
    render(<RecoveryEnrollmentWorkspace />, root),
  );
} else if (/^\/service\/?$/.test(window.location.pathname)) {
  void import("./service/app.js").then(({ ServiceWorkspace }) =>
    render(<ServiceWorkspace hostedPage={hostedPage} />, root),
  );
} else if (/^\/preview\/?$/.test(window.location.pathname)) {
  void import("./product/app.js").then(({ ProductPreview }) => render(<ProductPreview />, root));
} else if (/^\/observe\/?$/.test(window.location.pathname)) {
  void import("./observation/app.js").then(({ ObservationWorkspace }) =>
    render(<ObservationWorkspace />, root),
  );
} else {
  void import("./app.js").then(({ App }) => render(<App />, root));
}
