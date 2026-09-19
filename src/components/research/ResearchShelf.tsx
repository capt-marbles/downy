import { createContext, useContext } from "react";
import { defineRegistry, JSONUIProvider, Renderer } from "@json-render/react";
import { ArrowUpRight, FileText, Globe, FlaskConical } from "lucide-react";
import {
  researchCatalog,
  researchFileHref,
  type ResearchSnapshot,
} from "../../lib/research-view";
import StatusDot from "../ui/StatusDot";

const RecordsContext = createContext<{
  slug: string;
  snapshot: ResearchSnapshot;
} | null>(null);
const { registry } = defineRegistry(researchCatalog, {
  components: {
    Shelf: ({ props, children }) => (
      <div
        className={
          props.layout === "grid"
            ? "grid min-w-0 gap-4 sm:grid-cols-2"
            : "grid min-w-0 gap-4"
        }
      >
        {children}
      </div>
    ),
    Section: ({ props, children }) => (
      <section className="col-span-full min-w-0 space-y-3">
        <h2 className="mt-4 text-xs font-semibold uppercase tracking-widest text-base-content/55">
          {props.title}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">{children}</div>
      </section>
    ),
    Document: ({ props }) => {
      const context = useContext(RecordsContext);
      const record = context?.snapshot.records.find(
        (item) => item.id === props.recordId,
      );
      if (!context || !record) return null;
      const Icon =
        record.kind === "Browser capture"
          ? Globe
          : record.kind === "Pilot brief"
            ? FlaskConical
            : FileText;
      return (
        <article className="flex min-w-0 flex-col rounded-xl border border-base-300 bg-base-100 p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-2 text-xs">
            <span className="inline-flex items-center gap-2 font-medium text-base-content/65">
              <Icon size={15} />
              {record.kind}
            </span>
            <span className="inline-flex items-center gap-1.5 text-base-content/55">
              <StatusDot tone="success" />
              Saved file
            </span>
          </div>
          <h3 className="break-words text-lg font-semibold leading-snug tracking-tight">
            {record.title}
          </h3>
          <p className="mt-3 line-clamp-3 break-words text-sm leading-relaxed text-base-content/65">
            {record.excerpt}
          </p>
          <p className="mt-2 text-[11px] text-base-content/45">
            Excerpt from the saved document
          </p>
          <div className="mt-auto flex items-end justify-between gap-3 pt-5">
            <span className="text-xs leading-relaxed text-base-content/50">
              {new Date(record.updatedAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}
              <br />
              {Math.max(1, Math.round(record.size / 1024))} KB
            </span>
            <a
              className="btn btn-outline btn-sm min-h-11 gap-2"
              href={researchFileHref(context.slug, record.path)}
            >
              Open document <ArrowUpRight size={15} />
            </a>
          </div>
        </article>
      );
    },
  },
});

export default function ResearchShelf({
  slug,
  snapshot,
}: {
  slug: string;
  snapshot: ResearchSnapshot;
}) {
  return (
    <RecordsContext.Provider value={{ slug, snapshot }}>
      <JSONUIProvider registry={registry}>
        <Renderer spec={snapshot.spec} registry={registry} />
      </JSONUIProvider>
    </RecordsContext.Provider>
  );
}
