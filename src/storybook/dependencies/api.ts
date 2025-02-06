export async function download(url: string): Promise<Blob | null> {
  const response = await fetch(
    url,
    {
      method: 'GET',
      credentials: 'omit',
      headers: {
        Accept: 'application/octet-stream',
        'Content-Type': 'application/octet-stream',
      },
    },
  );

  const { status } = response;

  if ([404, 202, 204].includes(status)) {
    return null;
  }

  if (response.ok) {
    const blob = await response.blob();
    return blob;
  }

  throw new Error(response.toString());
}

export async function get(url: string): Promise<any> {
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