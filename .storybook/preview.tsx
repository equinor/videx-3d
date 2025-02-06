import type { Preview } from "@storybook/react";

const preview: Preview = {
  parameters: {
    docs: {
      story: {
        height: '600px',
      },
    },
    // controls: {
    //   matchers: {
    //     color: /(background|color)$/i,
    //     date: /Date$/i,
    //   },
    // },
  },
  tags: ['autodocs'],  
};

export default preview;
