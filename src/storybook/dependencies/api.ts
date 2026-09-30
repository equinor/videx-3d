export async function get(url: string): Promise<any> {
  //console.log(self)
  // use correct path when not running locally
  if (!self.location.origin.startsWith('http://')) {
    url = '/videx-3d' + url;
  }

  const response = await fetch(url, {
    method: 'GET',
    credentials: 'omit',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });

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

/** As {@link get}, but for payloads that are raw bytes rather than JSON. */
export async function getBinary(url: string): Promise<ArrayBuffer | null> {
  if (!self.location.origin.startsWith('http://')) {
    url = '/videx-3d' + url;
  }

  const response = await fetch(url, {
    method: 'GET',
    credentials: 'omit',
    headers: {
      Accept: 'application/octet-stream',
    },
  });

  const { status } = response;

  if ([404, 202, 204].includes(status)) {
    return null;
  }

  if (response.ok) {
    return response.arrayBuffer();
  }

  throw new Error(response.toString());
}
