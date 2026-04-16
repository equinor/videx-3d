export const idToHexColor = (num: number) =>
  `#${num.toString(16).padStart(6, '0')}`;

export function randomColor(): string {
  const letters = '123456789ABCDEF';
  let color = '#';
  for (let i = 0; i < 6; i++) {
    color += letters[Math.floor(Math.random() * 16)];
  }
  return color;
}
