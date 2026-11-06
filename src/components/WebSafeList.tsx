import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, FlatListProps, Platform, ScrollView } from 'react-native';

const LIST_PAGE = 60;

// Lange Listen: im Web einfacher ScrollView mit portionsweisem Nachladen (die
// FlatList-Virtualisierung misst dort die Zeilen nicht und bleibt bei 10 Zeilen
// stehen, Muster aus renderGamesList in MatchListScreen); nativ FlatList.
export function WebSafeList<T>(props: FlatListProps<T>) {
  const { data, renderItem, keyExtractor, ListHeaderComponent, ListEmptyComponent, contentContainerStyle, refreshControl, style } = props;
  const items = useMemo(() => (data ? Array.from(data as ArrayLike<T>) : []), [data]);
  const total = items.length;
  const [visible, setVisible] = useState(LIST_PAGE);
  useEffect(() => { setVisible(LIST_PAGE); }, [total]);

  if (Platform.OS !== 'web') return <FlatList {...props} />;

  const part = (c: any) => (React.isValidElement(c) ? c : c ? React.createElement(c) : null);
  return (
    <ScrollView
      style={style ?? { flex: 1 }}
      contentContainerStyle={contentContainerStyle}
      refreshControl={refreshControl}
      scrollEventThrottle={100}
      onScroll={(e) => {
        const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
        if (contentOffset.y + layoutMeasurement.height > contentSize.height - 400) {
          setVisible((c) => (c < total ? Math.min(c + LIST_PAGE, total) : c));
        }
      }}
    >
      {part(ListHeaderComponent)}
      {total === 0
        ? part(ListEmptyComponent)
        : items.slice(0, visible).map((item, index) => (
            <React.Fragment key={keyExtractor ? keyExtractor(item, index) : index}>
              {renderItem?.({ item, index, separators: undefined as any })}
            </React.Fragment>
          ))}
    </ScrollView>
  );
}
