import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import { emptyListCriteria, type ListCriteria } from '../../shared/utils/frontend/listView';

const ListViewContext = createContext<Map<string, ListCriteria> | null>(null);

export function ListViewProvider({ children }: { children: ReactNode }) {
  const store = useRef(new Map<string, ListCriteria>());
  return <ListViewContext.Provider value={store.current}>{children}</ListViewContext.Provider>;
}

export function useListCriteria(context: string) {
  const store = useContext(ListViewContext);
  const [criteria, setLocal] = useState<ListCriteria>(() => store?.get(context) ?? emptyListCriteria());
  const setCriteria = (next: ListCriteria) => {
    store?.set(context, next);
    setLocal(next);
  };
  return [criteria, setCriteria] as const;
}
