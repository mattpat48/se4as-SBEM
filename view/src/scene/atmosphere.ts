// Frame-level atmosphere shared by the scene layers: night factor, data mode and the current
// palette. Lighting updates it every frame; painters read it.
import { DAY, type Palette } from '../domain/palette';

export const atmosphere: { night: number; dataMode: boolean; palette: Palette } = { night: 0, dataMode: false, palette: DAY };
