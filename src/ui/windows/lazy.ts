import { lazy } from 'react'

// Window bodies load the first time their window opens, so the first page load carries only the map.
export const CctvWindow = lazy(() => import('./CctvWindow').then((m) => ({ default: m.CctvWindow })))
export const ChatWindow = lazy(() => import('./ChatWindow').then((m) => ({ default: m.ChatWindow })))
export const CountryWindow = lazy(() => import('./CountryWindow').then((m) => ({ default: m.CountryWindow })))
export const DisplayWindow = lazy(() => import('./DisplayWindow').then((m) => ({ default: m.DisplayWindow })))
export const IntelWindow = lazy(() => import('./IntelWindow').then((m) => ({ default: m.IntelWindow })))
export const MilitaryWindow = lazy(() => import('./MilitaryWindow').then((m) => ({ default: m.MilitaryWindow })))
export const NoticesWindow = lazy(() => import('./NoticesWindow').then((m) => ({ default: m.NoticesWindow })))
export const RadioWindow = lazy(() => import('./RadioWindow').then((m) => ({ default: m.RadioWindow })))
export const SyncWindow = lazy(() => import('./SyncWindow').then((m) => ({ default: m.SyncWindow })))
export const TransportWindow = lazy(() => import('./TransportWindow').then((m) => ({ default: m.TransportWindow })))
export const TvWindow = lazy(() => import('./TvWindow').then((m) => ({ default: m.TvWindow })))
