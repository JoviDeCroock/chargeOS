import type { ComponentChildren } from "preact";
import "./help.css";
import { BrandMark } from "./brand.js";

const files = import.meta.glob<string>("../docs/guides/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});
const order = [
  "README",
  "install",
  "deploy",
  "owner-console",
  "connect-a-charger",
  "ai-help",
  "brands",
  "people",
  "account-email",
  "company-hosting",
  "rfid",
  "reimbursements",
  "recovery",
];
const guides = order.map((id) => {
  const text = files[`../docs/guides/${id}.md`]!;
  return { id, text, title: text.split("\n")[0]!.replace(/^# /, "") };
});

function guideLink(href: string): string {
  if (href.startsWith("https://")) return href;
  if (/^[a-z-]+\.md$/.test(href) || href === "README.md") return `/help?guide=${href.slice(0, -3)}`;
  if (/^\.\.\/[a-z-]+\.md(?:#[a-z0-9-]+)?$/.test(href))
    return `https://github.com/JoviDeCroock/chargeOS/blob/main/docs/${href.slice(3)}`;
  return "/help";
}
function inline(text: string): ComponentChildren[] {
  return text.split(/(\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|`[^`]+`)/g).map((part, index) => {
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link)
      return (
        <a key={index} href={guideLink(link[2]!)}>
          {link[1]}
          {link[2]!.startsWith("../") ? " (online operator document)" : ""}
        </a>
      );
    if (part.startsWith("**") && part.endsWith("**"))
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`"))
      return <code key={index}>{part.slice(1, -1)}</code>;
    return part;
  });
}
// A deliberately small renderer for the maintained guide subset: headings,
// paragraphs, links, emphasis, code and flat lists. HTML is always escaped.
function Markdown({ text }: { text: string }) {
  const blocks = text.trim().split(/\n\s*\n/);
  return (
    <>
      {blocks.map((block, index) => {
        const heading = block.match(/^(#{1,3}) (.+)$/);
        if (heading?.[1] === "#") return <h1 key={index}>{heading[2]}</h1>;
        if (heading?.[1] === "##") return <h2 key={index}>{heading[2]}</h2>;
        if (heading?.[1] === "###") return <h3 key={index}>{heading[2]}</h3>;
        if (block.startsWith("- "))
          return (
            <ul key={index}>
              {block.split("\n").map((line, item) => (
                <li key={item}>{inline(line.replace(/^- /, ""))}</li>
              ))}
            </ul>
          );
        if (/^\d+\. /.test(block))
          return (
            <ol key={index}>
              {block.split("\n").map((line, item) => (
                <li key={item}>{inline(line.replace(/^\d+\. /, ""))}</li>
              ))}
            </ol>
          );
        return <p key={index}>{inline(block.replaceAll("\n", " "))}</p>;
      })}
    </>
  );
}
export function HelpWorkspace({ hostedPage = false }: { hostedPage?: boolean } = {}) {
  const requested = new URLSearchParams(location.search).get("guide") ?? "README";
  const guide = guides.find((item) => item.id === requested) ?? guides[0]!;
  return (
    <div class="help-root">
      <a class="help-skip" href="#guide">
        Skip to guide
      </a>
      <header>
        <a class="help-brand" href={hostedPage ? "/service" : "/"}>
          <BrandMark />
        </a>
        <span>Help</span>
        {!hostedPage && <a href="/">Owner console</a>}
        <a href="/service">Employer workspace</a>
      </header>
      <div class="help-layout">
        <nav aria-label="Help topics">
          {guides.map((item) => (
            <a
              key={item.id}
              href={`/help?guide=${item.id}`}
              aria-current={item.id === guide.id ? "page" : undefined}
            >
              {item.title}
            </a>
          ))}
        </nav>
        <main id="guide">
          <Markdown text={guide.text} />
          <footer>
            These guides are available offline. Linked operator documents open GitHub and need
            internet and repository access. Physical compatibility and financial payment require
            their own evidence.
          </footer>
        </main>
      </div>
    </div>
  );
}
