// Broker connection state and the publish function of the current client.
import { create } from 'zustand';

export type BrokerState = 'connecting' | 'online' | 'offline' | 'auth_failed';
export type PublishJson = (topic: string, obj: unknown, qos: 0 | 1) => void;

interface ConnectionState {
  broker: BrokerState;
  publishJson: PublishJson | null;
  setBroker(b: BrokerState): void;
  setPublisher(p: PublishJson | null): void;
}

export const useConnectionStore = create<ConnectionState>()((set) => ({
  broker: 'connecting',
  publishJson: null,
  setBroker: (broker) => set({ broker }),
  setPublisher: (publishJson) => set({ publishJson }),
}));
