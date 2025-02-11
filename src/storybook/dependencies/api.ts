export async function get(url: string): Promise<any> {

  // avoid CORS issue when hosted on Github Pages
  if (!self.location.origin.startsWith('http://localhost')) {
    url = url.slice(1)
  }

  const response = await fetch(
    url,
    {
      method: 'GET',
      credentials: 'omit',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    },
  );

  const { status } = response;

  if ([404, 202, 204].includes(status)) {
    return null;
  }

  if (response.ok) {
    const data = await response.json();
    return data;
  }

  throw new Error(response.toString());
}