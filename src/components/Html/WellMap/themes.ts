export type WellMapStyles = {
  depthAxisWidth: number;
  depthAxisColor: string;
  kickoffAxisColor: string;
  cursorColor: string;
  rulerColor: string;
  activeTrackColor: string;
  readoutColor: string;
  textColor: string;
  darkMode: boolean;
};

export const DarkTheme: WellMapStyles = {
  depthAxisWidth: 30,
  depthAxisColor: '#555',
  kickoffAxisColor: '#aaa',
  cursorColor: 'white',
  readoutColor: 'orange',
  rulerColor: 'red',
  activeTrackColor: 'white',
  textColor: 'white',
  darkMode: true,
};

export const LightTheme: WellMapStyles = {
  depthAxisWidth: 30,
  depthAxisColor: '#ddd',
  kickoffAxisColor: '#aaa',
  cursorColor: '#aaa',
  readoutColor: 'orange',
  rulerColor: 'red',
  activeTrackColor: 'white',
  textColor: '#555',
  darkMode: false,
};
