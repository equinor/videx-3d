import { useEffect, useState } from 'react';
import { useData } from '../../hooks/useData';
import type { KeyType } from '../../sdk';

/**
 * One record from the story's store (`store.get`): null until it arrives, where there is
 * none, and for a null `key`.
 */
export function useStoreRecord<T>(
  dataType: string,
  key: KeyType | null,
): T | null {
  const store = useData();
  const [record, setRecord] = useState<{
    key: KeyType | null;
    value: T | null;
  }>({ key: null, value: null });
  useEffect(() => {
    if (!store || key === null) return;
    let cancelled = false;
    store.get<T>(dataType, key).then(value => {
      if (!cancelled) setRecord({ key, value });
    });
    return () => {
      cancelled = true;
    };
  }, [store, dataType, key]);
  return key !== null && record.key === key ? record.value : null;
}
