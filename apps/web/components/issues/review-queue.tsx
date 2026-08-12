import { ButtonLink, StatusDot } from "@facility/ui";
import Link from "next/link";
import type { PipelineStory } from "@/lib/api";
import { storyHref } from "@/lib/pipeline";
import { fmtAgo } from "@/lib/run-format";
import { reviewPullRequestGroups } from "@/lib/story-groups";

/** A pull request is one review action even when it delivers several stories. */
export function ReviewQueue({
  projectId,
  stories,
}: {
  projectId: string;
  stories: PipelineStory[];
}) {
  const groups = reviewPullRequestGroups(stories);

  return (
    <div className="flex flex-col border border-(--line)">
      {groups.map(({ key, pull, stories: includedStories }) => {
        const representative = includedStories[0];
        if (!representative) return null;
        return (
          <article
            key={key}
            className="flex flex-col gap-3 border-b border-(--line) px-5 py-4 last:border-b-0"
          >
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="font-mono text-[11px] text-(--info)">PR #{pull.number}</span>
              <a
                href={pull.url}
                target="_blank"
                rel="noreferrer"
                className="min-w-64 flex-1 text-[13.5px] font-medium text-(--ink) underline-offset-4 hover:underline"
              >
                {pull.title}
              </a>
              <span className="font-mono text-[10.5px] text-(--dim)">
                {representative.repoOwner}/{representative.repoName}
              </span>
              {pull.ciState ? (
                <span className="inline-flex items-center gap-2 font-mono text-[10.5px] text-(--mut)">
                  <StatusDot
                    tone={
                      pull.ciState === "failure"
                        ? "bad"
                        : pull.ciState === "pending"
                          ? "info"
                          : "ok"
                    }
                  />
                  checks {pull.ciState}
                </span>
              ) : null}
              <span className="font-mono text-[10.5px] text-(--dim)">
                opened {fmtAgo(pull.createdAt)}
              </span>
              <ButtonLink size="sm" href={pull.url} target="_blank" rel="noreferrer">
                Review PR ↗
              </ButtonLink>
            </div>

            <details className="group">
              <summary className="flex w-fit cursor-pointer list-none items-center gap-2 font-mono text-[10.5px] text-(--dim) hover:text-(--mut) [&::-webkit-details-marker]:hidden">
                <span aria-hidden className="transition-transform group-open:rotate-90">
                  ▸
                </span>
                {includedStories.length} {includedStories.length === 1 ? "story" : "stories"}
              </summary>
              <div className="mt-2 flex flex-col gap-1 border-l border-(--line) pl-4">
                {includedStories.map((story) => (
                  <Link
                    key={story.key}
                    href={storyHref(projectId, story)}
                    className="text-[12px] text-(--mut) underline-offset-4 hover:text-(--ink) hover:underline"
                  >
                    <span className="font-mono text-[10.5px] text-(--dim)">#{story.number}</span>{" "}
                    {story.title}
                  </Link>
                ))}
              </div>
            </details>
          </article>
        );
      })}
    </div>
  );
}
