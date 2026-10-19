'use client';

import { SettingsProvider } from '@/hooks/useSettings';
import EngineerleApp from './EngineerleApp';

export function EngineerleSite() {
  return (
    <SettingsProvider>
      <EngineerleApp />
    </SettingsProvider>
  );
}
