import {
  Anchor,
  ArgTypes,
  Canvas,
  Controls,
  Description,
  DocsContext,
  Heading,
  Primary,
  Subheading,
  Subtitle,
  Title,
} from '@storybook/addon-docs/blocks';
import { useContext, type MouseEvent } from 'react';
import { SELECT_STORY } from 'storybook/internal/core-events';
import type { PreparedStory } from 'storybook/internal/types';
import { addons } from 'storybook/preview-api';
import { styled } from 'storybook/theming';

/**
 * The tag that gives a story a live preview on its Docs page: on a meta, every story of the
 * file. Without it a story is described and linked, not rendered (see {@link DocsPage}).
 */
export const DOCS_PREVIEW_TAG = 'docs-preview';

const previewed = (story: PreparedStory) =>
  story.tags.includes(DOCS_PREVIEW_TAG);

// As Storybook's own Stories block: those its autodocs tag leaves in, none that mount.
function docsStories(stories: PreparedStory[]) {
  return stories.some(story => story.tags.includes('autodocs'))
    ? stories.filter(
        story => story.tags.includes('autodocs') && !story.usesMount,
      )
    : stories;
}

const StoriesHeading = styled(Heading)(({ theme }) => ({
  fontSize: `${theme.typography.size.s2 - 1}px`,
  fontWeight: theme.typography.weight.bold,
  lineHeight: '16px',
  letterSpacing: '0.35em',
  textTransform: 'uppercase',
  color: theme.textMutedColor,
  border: 0,
  marginTop: '56px',
  marginBottom: '12px',
}));

const Link = styled.a(({ theme }) => ({
  display: 'inline-block',
  margin: '4px 0 16px',
  fontSize: `${theme.typography.size.s2}px`,
  fontWeight: theme.typography.weight.bold,
  color: theme.color.secondary,
  textDecoration: 'none',
  '&:hover': { textDecoration: 'underline' },
}));

/** A link to the story in the Canvas: the manager switches to it; a modified click opens a tab. */
const OpenInCanvas = ({ storyId }: { storyId: string }) => {
  const open = (event: MouseEvent) => {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    addons.getChannel().emit(SELECT_STORY, { storyId });
  };
  return (
    <Link href={`./?path=/story/${storyId}`} target="_top" onClick={open}>
      Open in Canvas ↗
    </Link>
  );
};

/**
 * The project's Docs page: the written docs and the props table, with no story rendered unless
 * it opts in ({@link DOCS_PREVIEW_TAG}). Every 3D story is a WebGL scene of its own, and a Docs
 * page rendering them all is slow to open and heavy to keep. A page whose first story opts in
 * shows it with live controls, as Storybook's own page does; otherwise the props table is
 * read-only. Each story is listed with its description and a link to it in the Canvas, or its
 * preview where it opts in.
 */
export const DocsPage = () => {
  const context = useContext(DocsContext);
  const stories = docsStories(context.componentStories());
  const primary = stories[0];
  const single = stories.length === 1;
  const live = !!primary && previewed(primary);
  return (
    <>
      <Title />
      <Subtitle />
      <Description of="meta" />
      {single && <Description of={primary.moduleExport} />}
      {primary &&
        (live ? (
          <>
            <Primary />
            <Controls />
          </>
        ) : (
          <>
            {single && <OpenInCanvas storyId={primary.id} />}
            <ArgTypes of={primary.moduleExport} />
          </>
        ))}
      {!single && stories.length > 0 && (
        <>
          <StoriesHeading>Stories</StoriesHeading>
          {stories.map(story => (
            <Anchor key={story.id} storyId={story.id}>
              <Subheading>{story.name}</Subheading>
              <Description of={story.moduleExport} />
              {previewed(story) && !(live && story === primary) ? (
                <Canvas of={story.moduleExport} />
              ) : (
                <OpenInCanvas storyId={story.id} />
              )}
            </Anchor>
          ))}
        </>
      )}
    </>
  );
};
