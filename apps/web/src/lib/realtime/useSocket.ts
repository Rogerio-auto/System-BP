// =============================================================================
// lib/realtime/useSocket.ts — Re-exporta useSocket do SocketProvider (F16-S15).
//
// Ponto de importação público para os consumidores do socket.
// Evita que features importem diretamente de SocketProvider.tsx
// (que exporta também o Provider — componente React).
//
// Uso:
//   import { useSocket } from '@/lib/realtime/useSocket';
// =============================================================================

export { useSocket } from './SocketProvider';
