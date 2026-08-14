import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { Card, Chip, CodeText, Screen } from '@/components/ui';
import { useCodes } from '@/lib/codes';
import { clock } from '@/lib/format';
import type { CodeRow } from '@/lib/api';

const FILTERS = ['All', 'Used', 'Expired'] as const;
type Filter = (typeof FILTERS)[number];

function subtitle(c: CodeRow): string {
  if (c.status === 'used' && c.used_at) {
    const d = new Date(c.used_at);
    const today = d.toDateString() === new Date().toDateString();
    return today
      ? `Used ${clock(c.used_at)}`
      : `Used ${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${clock(c.used_at)}`;
  }
  if (c.status === 'revoked') return c.revoked_reason ? `Revoked · ${c.revoked_reason.replace(/_/g, ' ')}` : 'Revoked';
  if (c.status === 'expired') return 'Never used';
  return 'Live';
}

export default function History() {
  const { codes, loading, refresh } = useCodes();
  const [filter, setFilter] = useState<Filter>('All');

  const rows = useMemo(() => {
    if (filter === 'All') return codes;
    if (filter === 'Used') return codes.filter((c) => c.status === 'used');
    return codes.filter((c) => c.status === 'expired' || c.status === 'revoked');
  }, [codes, filter]);

  return (
    <Screen>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerClassName="pb-28"
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}
      >
        <Text className="mt-3 font-jk-xb text-display tracking-tight text-ink">History</Text>

        <View className="mt-4 flex-row gap-2">
          {FILTERS.map((f) => {
            const on = f === filter;
            return (
              <Pressable
                key={f}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => setFilter(f)}
                className={`h-8 justify-center rounded-full px-3.5 ${on ? 'bg-ink' : 'bg-card'}`}
              >
                <Text className={`font-jk-b text-micro ${on ? 'text-canvas' : 'text-muted'}`}>
                  {f}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View className="mt-4 gap-2.5">
          {rows.map((c) => (
            <Card key={c.id} className="flex-row items-center justify-between p-4">
              <View className="flex-1 pr-3">
                <CodeText code={c.code} className="text-[20px]" />
                <Text className="mt-1.5 font-jk text-micro text-muted">{subtitle(c)}</Text>
              </View>
              {c.status === 'used' ? (
                <Chip label="Used" />
              ) : c.status === 'live' ? (
                <Chip label="Live" />
              ) : (
                <Chip label={c.status === 'revoked' ? 'Revoked' : 'Expired'} tone="field" />
              )}
            </Card>
          ))}
        </View>

        {rows.length === 0 ? (
          <Text className="mt-8 text-center font-jk text-sub text-muted">
            Nothing here yet.
          </Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
