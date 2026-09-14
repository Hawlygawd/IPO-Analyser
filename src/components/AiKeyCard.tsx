/**
 * Settings card for the bring-your-own-key live assist.
 *
 * Three things happen here and nowhere else: the key is saved (keychain on iOS/Android),
 * it is tested with a real request so the user knows it works before they rely on it, and a
 * dry-run search proves the model returns figures this app can actually merge onto the board.
 */

import { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { radius, Theme } from '../theme';
import { Button, KeyValueRow, SectionCard } from './ui';
import { useAi } from '../lib/ai/settings';
import { AI_PROVIDERS, searchCapability, type AiProviderId } from '../lib/ai/providers';
import { useStore } from '../lib/store';

/** The providers worth a one-tap pick; "Other" covers everything OpenAI-compatible. */
const PICKER: (AiProviderId | 'auto')[] = [
  'auto',
  'gemini',
  'openai',
  'xai',
  'nvidia',
  'groq',
  'openrouter',
  'anthropic',
  'mistral',
  'perplexity',
  'custom',
];

function chipLabel(id: AiProviderId | 'auto'): string {
  if (id === 'auto') return 'Auto-detect';
  const spec = AI_PROVIDERS.find((provider) => provider.id === id);
  return spec ? spec.label.replace(' (OpenAI-compatible)', '') : id;
}

export function AiKeyCard({ theme }: { theme: Theme }) {
  const { showToast, refreshWithAi, refreshing, live } = useStore();
  const ai = useAi();
  const [draft, setDraft] = useState('');
  const [reveal, setReveal] = useState(false);

  const saved = Boolean(ai.key);
  const provider = AI_PROVIDERS.find((spec) => spec.id === ai.providerId);

  const steps = ai.check?.steps ?? [];

  const save = async () => {
    const result = await ai.save(draft.trim());
    showToast(result.message, result.ok ? 'up' : 'down');
    if (result.ok) setDraft('');
  };

  return (
    <SectionCard
      theme={theme}
      title="Live data key (AI assist)"
      subtitle={
        saved
          ? `${ai.keyLabel} • ${ai.stored === 'keychain' ? 'stored in the device keychain' : 'stored on this device'}`
          : 'Optional. Paste a free-tier API key so a refresh can search the web for the latest figures even when the IPO Ji boards are blocked.'
      }
      style={{ marginTop: 14 }}
      right={
        saved ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              backgroundColor: ai.enabled ? theme.upSoft : theme.neutralSoft,
              paddingHorizontal: 9,
              paddingVertical: 5,
              borderRadius: radius.pill,
            }}
          >
            <Ionicons
              name={ai.enabled ? 'flash' : 'flash-off-outline'}
              size={11}
              color={ai.enabled ? theme.up : theme.neutral}
            />
            <Text style={{ fontSize: 10.5, fontWeight: '800', color: ai.enabled ? theme.up : theme.neutral }}>
              {ai.enabled ? 'Armed' : 'Paused'}
            </Text>
          </View>
        ) : undefined
      }
    >
      {saved ? (
        <>
          <KeyValueRow theme={theme} label="Key" value={ai.keyLabel} />
          <KeyValueRow theme={theme} label="Detected as" value={ai.shapeLabel || (provider ? provider.label : 'Unknown')} />
          <KeyValueRow
            theme={theme}
            label="Used on"
            value={
              live.ai?.used
                ? `Last refresh: ${live.ai.rows} rows from ${live.ai.providerLabel}`
                : ai.enabled
                  ? 'Refresh (only when the boards fail)'
                  : 'Paused - boards only'
            }
            multiline
          />
          {provider?.freeTier ? (
            <KeyValueRow theme={theme} label="Provider plan" value={provider.freeTier} multiline />
          ) : null}
        </>
      ) : null}

      <View style={{ marginTop: saved ? 12 : 2 }}>
        <Text style={{ fontSize: 11.5, fontWeight: '700', color: theme.textMuted, marginBottom: 6 }}>
          {saved ? 'Replace with a different key' : 'API key'}
        </Text>
        <View style={[styles.inputRow, { backgroundColor: theme.cardAlt, borderColor: theme.border }]}>
          <Ionicons name="key-outline" size={15} color={theme.textMuted} />
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Paste any key - Gemini, OpenAI, NVIDIA, Grok, Groq…"
            placeholderTextColor={theme.textMuted}
            accessibilityLabel="API key"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry={!reveal}
            style={{ flex: 1, color: theme.text, fontSize: 13, paddingVertical: 8 }}
          />
          <Pressable
            onPress={() => setReveal((value) => !value)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={reveal ? 'Hide the key' : 'Show the key'}
          >
            <Ionicons name={reveal ? 'eye-off-outline' : 'eye-outline'} size={16} color={theme.textMuted} />
          </Pressable>
        </View>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
          <Button
            theme={theme}
            label={saved ? 'Save new key' : 'Save key'}
            icon="save-outline"
            disabled={draft.trim().length === 0}
            onPress={save}
            style={{ flex: 1 }}
          />
          {saved ? (
            <Button
              theme={theme}
              label="Remove key"
              variant="danger"
              icon="trash-outline"
              onPress={async () => {
                await ai.remove();
                showToast('Key removed from this device', 'info');
              }}
            />
          ) : null}
        </View>
        <Text style={{ fontSize: 11, color: theme.textMuted, marginTop: 8, lineHeight: 16 }}>
          The key is saved on this device only - never uploaded, never logged, and used for nothing
          except your own live-data searches{ai.viaProxy ? '. In this web build the request goes through the app’s own /api/ai route, because browsers are blocked by the provider APIs directly' : ''}.
        </Text>
      </View>

      <View style={[styles.divider, { borderTopColor: theme.border }]} />

      <Text style={{ fontSize: 11.5, fontWeight: '700', color: theme.textMuted, marginBottom: 6 }}>
        Provider
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 7 }}>
        {PICKER.map((id) => {
          const active = id === 'auto' ? ai.providerId === null : ai.providerId === id;
          return (
            <Pressable
              key={id}
              onPress={() => ai.setProvider(id === 'auto' ? null : id)}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`Use ${chipLabel(id)}`}
              style={{
                paddingHorizontal: 11,
                paddingVertical: 7,
                borderRadius: radius.pill,
                borderWidth: 1.5,
                borderColor: active ? theme.primary : theme.border,
                backgroundColor: active ? theme.primarySoft : theme.cardAlt,
              }}
            >
              <Text style={{ fontSize: 11.5, fontWeight: '700', color: active ? theme.primary : theme.textSub }}>
                {chipLabel(id)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 11.5, fontWeight: '700', color: theme.textMuted }}>Model</Text>
          <TextInput
            value={ai.model ?? ''}
            onChangeText={(value) => ai.setModel(value.trim() ? value.trim() : null)}
            placeholder="Auto (cheapest model the key can reach)"
            placeholderTextColor={theme.textMuted}
            accessibilityLabel="Model"
            autoCapitalize="none"
            autoCorrect={false}
            style={[
              styles.lineInput,
              { backgroundColor: theme.cardAlt, borderColor: theme.border, color: theme.text },
            ]}
          />
        </View>
      </View>

      {ai.providerId === 'custom' ? (
        <TextInput
          value={ai.baseUrl ?? ''}
          onChangeText={(value) => ai.setBaseUrl(value.trim() ? value.trim() : null)}
          placeholder="https://your-endpoint.example/v1"
          placeholderTextColor={theme.textMuted}
          accessibilityLabel="Base URL"
          autoCapitalize="none"
          autoCorrect={false}
          style={[
            styles.lineInput,
            { backgroundColor: theme.cardAlt, borderColor: theme.border, color: theme.text, marginTop: 8 },
          ]}
        />
      ) : null}

      <View style={[styles.switchRow, { borderTopColor: theme.border }]}>
        <View style={{ flex: 1, paddingRight: 10 }}>
          <Text style={{ fontSize: 13.5, fontWeight: '700', color: theme.text }}>Use during refresh</Text>
          <Text style={{ fontSize: 11.5, color: theme.textMuted, marginTop: 2, lineHeight: 16 }}>
            Spends one search request per refresh, and only when the boards come back empty or fail.
            {' '}
            {ai.providerId
              ? `This key is ${provider?.label ?? ai.providerId}, which ${searchCapability(
                  AI_PROVIDERS.find((spec) => spec.id === ai.providerId) ?? AI_PROVIDERS[0]
                )}.`
              : 'A key that cannot search the web is never asked to guess live figures.'}
          </Text>
        </View>
        <Switch
          value={ai.enabled}
          onValueChange={ai.setEnabled}
          trackColor={{ true: theme.primary, false: theme.border }}
          thumbColor="#FFFFFF"
          accessibilityLabel="Use during refresh"
        />
      </View>

      <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <Button
          theme={theme}
          label="Test this key"
          variant="soft"
          icon="flask-outline"
          loading={ai.busy}
          disabled={!saved}
          onPress={async () => {
            const result = await ai.test();
            showToast(
              result.ok
                ? `Key works - ${result.providerLabel} • ${result.model}`
                : `Key check failed - ${result.error ?? 'no answer'}`,
              result.ok ? 'up' : 'down'
            );
          }}
          style={{ flexGrow: 1 }}
        />
        <Button
          theme={theme}
          label="Dry-run a search"
          variant="ghost"
          icon="sparkles-outline"
          loading={ai.busy}
          disabled={!saved}
          onPress={async () => {
            const result = await ai.drySearch();
            showToast(
              result.ok
                ? `Search works - ${result.rows.length} rows from ${result.model}`
                : `Search failed - ${result.error ?? 'no rows'}`,
              result.ok ? 'up' : 'down'
            );
          }}
          style={{ flexGrow: 1 }}
        />
      </View>

      {ai.check ? (
        <View
          style={[
            styles.result,
            {
              backgroundColor: ai.check.ok ? theme.upSoft : theme.downSoft,
              borderColor: ai.check.ok ? theme.up : theme.down,
            },
          ]}
        >
          <Text style={{ fontSize: 12.5, fontWeight: '800', color: ai.check.ok ? theme.up : theme.down }}>
            {ai.check.ok
              ? `Key works - ${ai.check.providerLabel} • ${ai.check.model} answered in ${(ai.check.latencyMs / 1000).toFixed(1)}s`
              : // a provider-side failure (overload, retired model names, quota) is not the key's
                // fault, and the headline must not tell the user their key is broken
                /not rejected/.test(ai.check.hint ?? '')
                ? `Provider trouble - ${ai.check.error ?? 'no answer'}`
                : `Key failed - ${ai.check.error ?? 'no answer'}`}
          </Text>
          {ai.check.hint ? (
            <Text style={{ fontSize: 11.5, color: theme.textSub, marginTop: 4, lineHeight: 16 }}>
              {ai.check.hint}
            </Text>
          ) : null}
          {steps.map((step) => (
            <Text
              key={step.label}
              style={{ fontSize: 11.5, color: step.ok ? theme.textSub : theme.down, marginTop: 4, lineHeight: 16 }}
            >
              {step.ok ? '✓' : '✗'} {step.label} - {step.detail}
            </Text>
          ))}
          {ai.check.tried.length > 1 ? (
            <Text style={{ fontSize: 11, color: theme.textMuted, marginTop: 4, lineHeight: 16 }}>
              Also tried: {ai.check.tried.map((tryInfo) => `${tryInfo.label} (${tryInfo.error})`).join(', ')}
            </Text>
          ) : null}
        </View>
      ) : null}

      {ai.dryRun ? (
        <View
          style={[
            styles.result,
            {
              backgroundColor: ai.dryRun.ok ? theme.infoSoft : theme.warnSoft,
              borderColor: ai.dryRun.ok ? theme.info : theme.warn,
            },
          ]}
        >
          <Text style={{ fontSize: 12.5, fontWeight: '800', color: ai.dryRun.ok ? theme.info : theme.warn }}>
            {ai.dryRun.ok
              ? `Search works - ${ai.dryRun.rows.length} rows from ${ai.dryRun.providerLabel} • ${ai.dryRun.model} in ${(ai.dryRun.latencyMs / 1000).toFixed(1)}s`
              : `Search failed - ${ai.dryRun.error ?? 'no rows'}`}
          </Text>
          {ai.dryRun.ok ? (
            <>
              <Text style={{ fontSize: 11.5, color: theme.textSub, marginTop: 4, lineHeight: 16 }}>
                {ai.dryRun.search ? 'Web search was on.' : 'Web search was off for this provider.'}
                {ai.dryRun.asOf ? ` Newest reported stamp ${ai.dryRun.asOf}.` : ''}
                {ai.dryRun.rejected > 0 ? ` ${ai.dryRun.rejected} row(s) dropped as unverifiable.` : ''}
              </Text>
              {ai.dryRun.rows.slice(0, 3).map((row) => (
                <Text key={row.name} style={{ fontSize: 11.5, color: theme.textSub, marginTop: 4, lineHeight: 16 }}>
                  • {row.name}: {row.gmp !== undefined ? `GMP +₹${row.gmp}` : 'no premium'}
                  {row.subscriptionTotal !== undefined ? `, ${row.subscriptionTotal}x subscribed` : ''}
                  {row.closeDate ? `, closes ${row.closeDate}` : ''}
                </Text>
              ))}
            </>
          ) : (
            <Text style={{ fontSize: 11.5, color: theme.textSub, marginTop: 4, lineHeight: 16 }}>
              {ai.dryRun.reasons.slice(0, 3).join(' ') || ai.dryRun.hint || 'Check the model name, then try again.'}
            </Text>
          )}
        </View>
      ) : null}

      <Button
        theme={theme}
        label="Refresh with an AI search now"
        variant="ghost"
        icon="sparkles-outline"
        loading={refreshing}
        disabled={!saved || !ai.enabled}
        onPress={refreshWithAi}
        style={{ marginTop: 12 }}
      />

      <View style={{ marginTop: 10, gap: 6 }}>
        {AI_PROVIDERS.filter((spec) => spec.consoleUrl && ['gemini', 'openai', 'nvidia', 'xai', 'groq'].includes(spec.id)).map(
          (spec) => (
            <Pressable
              key={spec.id}
              onPress={() => Linking.openURL(spec.consoleUrl).catch(() => undefined)}
              accessibilityRole="link"
              accessibilityLabel={`Get a ${spec.label} key`}
            >
              <Text style={{ fontSize: 11.5, color: theme.primary, fontWeight: '700' }}>
                Get a {spec.label} key ({spec.freeTier}) →
              </Text>
            </Pressable>
          )
        )}
      </View>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 11,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  lineInput: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 11,
    paddingVertical: 9,
    fontSize: 12.5,
    marginTop: 6,
  },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, marginVertical: 14 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    marginTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  result: { borderWidth: 1, borderRadius: radius.md, padding: 11, marginTop: 12 },
});
