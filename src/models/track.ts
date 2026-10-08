export type Track = {
    reccobeatsId: string;
    spotifyId: string;
    title: string;
    artist: string;
    duration: number;
    albumImageUrl: string;    
    valence: number;
    arousal: number;
    requestStatus: 'available' | 'out-of-mood' | 'already-queued';
}