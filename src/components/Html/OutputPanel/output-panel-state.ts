import { create } from 'zustand';

export type OutputPanelDetails = Record<
  string,
  {
    label: string;
    value: string | number;
  }
>;

export type OutputPanelGroup = {
  label: string;
  value?: string | number;
  details?: OutputPanelDetails;
  color?: string;
  order?: number;
};

export type OutputPanelState = {
  groups: Record<string, OutputPanelGroup>;
  set: (
    partial:
      | ((state: OutputPanelState) => Partial<OutputPanelState>)
      | Partial<OutputPanelState>,
  ) => void;
  has: (id: string) => boolean;
};

/**
 * Global state for `OutputPanel`
 * @see {@link useOutputPanel}
 * @internal
 * @group Hooks
 */
export const useOutputPanelState = create<OutputPanelState>((set, get) => ({
  groups: {},
  set,
  has: id => get().groups[id] !== undefined,
}));

/**
 * Allow interaction with the `OutputPanel` component.
 * The `OutputPanel` is mainly used as an example of the `Panel` component.
 * It is used in storybooks as a debug/info panel. Not recommended to use for production.
 * @see {@link OutputPanel}
 * @internal
 * @group Hooks
 */
export const useOutputPanel = () => {
  const set = useOutputPanelState(state => state.set);
  const has = useOutputPanelState(state => state.has);

  return {
    add: (id: string, group: OutputPanelGroup) =>
      set(state =>
        state.groups[id]
          ? state.groups
          : { groups: { ...state.groups, [id]: group } },
      ),
    remove: (id: string) =>
      set(state => {
        const newGroupsState = { ...state.groups };
        delete newGroupsState[id];
        return { groups: newGroupsState };
      }),
    removeAll: () => set({ groups: {} }),
    update: (
      id: string,
      value: string | number,
      details?: Record<string, string | number> | null,
    ) =>
      set(state => {
        const group = state.groups[id];
        if (group) {
          const groupDetails: OutputPanelDetails | undefined = group.details
            ? { ...group.details }
            : undefined;
          if (groupDetails && details) {
            Object.keys(details).forEach(key => {
              if (groupDetails[key]) {
                groupDetails[key].value = details[key];
              }
            });
          }
          return {
            groups: {
              ...state.groups,
              [id]: {
                ...group,
                value,
                details: details === null ? undefined : groupDetails,
              },
            },
          };
        }

        return { groups: state.groups };
      }),
    has,
  };
};
