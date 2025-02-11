export async function get(url: string): Promise<any> {

  // use correct path when not running locally
  if (!self.location.origin.startsWith('http://localhost')) {
    url = '/videx-3d' + url
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