# Client Tracks Manager

The Client Tracks Manager is responsible for finding and playing tracks in Roon based on track metadata. This module serves as the bridge between user track requests and the Roon API, providing robust track matching and playback functionality.

## Overview

The module's main function, `findTracksInRoon`, attempts to match and play a list of tracks in Roon using two different search strategies:

1. **Album-based search (primary method)**: Searches for the track within its album context
2. **Direct search (fallback method)**: Searches for the track directly using the track title and artist

For each track, the system first attempts to find it via album search, and if that fails, falls back to direct search.

**Important Playback Behavior:**
- The first successfully found track is played immediately ("Play Now")
- All subsequent tracks are added to the queue ("Add to Queue")
- Any tracks that can't be found are collected in an "unmatched tracks" list
- This unmatched tracks list is returned at the end of the operation for display to the user

## Roon API Navigation Pattern

The Roon API uses a hierarchical navigation pattern that mimics the Roon user interface. This involves two main API calls:

- **browse**: Navigate to a specific level in the hierarchy or perform a search
- **load**: Load the items at the current level in the hierarchy

All navigation happens within a "browse session" identified by a `multi_session_key`.

## Navigation Flow Diagram

The Roon API navigation follows this general pattern:

```
┌─────────────────────┐     ┌─────────────────────┐     ┌─────────────────────┐
│       browse()      │     │       load()        │     │      browse()       │
│                     │     │                     │     │                     │
│  Initialize or move │     │ Load items at the   │     │  Select an item to  │
│  to a hierarchy     │──→  │ current level       │──→  │  navigate deeper    │
│                     │     │                     │     │                     │
└─────────────────────┘     └─────────────────────┘     └─────────────────────┘
         │                                                        │
         └────────────────────────────────────────────────────────┘
                              Repeat as needed

```

For example, to find a track in an album:

```
┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│   browse()  │   │   load()    │   │  browse()   │   │   load()    │   │  browse()   │
│             │   │             │   │             │   │             │   │             │
│  Go to      │──→│ Load        │──→│ Select      │──→│ Load        │──→│ Select      │
│  Library    │   │ sections    │   │ Search      │   │ search UI   │   │ album name  │
└─────────────┘   └─────────────┘   └─────────────┘   └─────────────┘   └─────────────┘
       │                                                                       │
       └───────────────────────────────────────────────────────────────────────┘
                                  Continue to track
```

## Album-Based Search Flow

The album-based search strategy (`findTrackByAlbum`) follows these steps:

1. **Navigate to Library**: Starts at the root menu and drills down to the Library section
2. **Access Search**: Navigates to the Search section within Library
3. **Perform Album Search**: Searches for the album by its name
4. **Navigate to Albums Section**: From search results, selects the Albums section
5. **Find Matching Album**: Normalizes album names and finds a match
6. **Browse Album Contents**: Navigates into the album to view tracks
7. **Find Matching Track**: Normalizes track names and finds a match
8. **Play Track**: Uses album-specific playback method to play the track

This approach ensures tracks are played from their correct album context, maintaining album continuity and providing the best audio quality.

## Direct Search Flow

The direct search strategy (`findTrackInSearchResults`) follows these steps:

1. **Perform Track Search**: Searches by track name, then by artist + track name
2. **Check for Direct Matches**: Looks for direct matches in the search results
3. **Navigate to Tracks Section**: If no direct match, checks the Tracks section 
4. **Find Matching Track**: Uses both exact and flexible matching algorithms
5. **Queue Track**: Uses the track's item key to queue it for playback

This approach is more flexible but may not maintain album context.

## Challenges in Music Track Matching

Music track matching presents several unique challenges that this implementation addresses:

### 1. Metadata Inconsistencies

**Challenge**: Track metadata often varies between source systems (e.g., Spotify, Apple Music) and Roon.

**Solution**: 
- Aggressive normalization of strings removes diacritics, punctuation, and case differences
- Multiple search variations are tried in sequence
- Both exact and fuzzy matching algorithms are implemented

### 2. Artist Name Variations

**Challenge**: Artist names can be represented differently (e.g., "The Beatles" vs "Beatles").

**Solution**:
- Special normalization for artist names in `normalizeArtistName`
- Handling of common artist name variations
- Flexible matching for collaborations and featured artists

### 3. Classical Music Complexities

**Challenge**: Classical music often has complex naming conventions (e.g., "Mozart: Symphony No. 40 in G minor, K.550").

**Solution**:
- Special handling for key signatures via `extractKeySignature`
- Cleaning of classical titles with `cleanClassicalTitle`
- Recognition of composer/work pattern in track names

### 4. Remastered/Alternative Versions

**Challenge**: Many tracks exist in multiple versions (Original, Remastered, Live, etc.).

**Solution**:
- Normalization removes version information
- Track matching ignores parenthetical information like "(2009 Remaster)"
- Base title matching when exact matches fail

### 5. Track Numbering

**Challenge**: Track titles often include track numbers in various formats.

**Solution**:
- Normalization removes leading numbers and disc-track numbers
- Pattern recognition for common numbering formats

### 6. API Navigation Complexity

**Challenge**: Finding and playing a specific track requires multiple API calls and complex navigation.

**Solution**:
- Implementation of two different search strategies
- Comprehensive error handling with fallbacks
- Session management with `resetBrowseSession`

## Track Matching Algorithm

The module employs sophisticated track matching logic:

### String Normalization

Both `normalizeString` and `normalizeArtistName` functions prepare strings for comparison by:

- Converting to lowercase
- Removing diacritics and accents
- Standardizing punctuation and special characters
- Removing version information (remaster, remix, etc.)
- Handling track numbers and disc numbers
- Handling artist name variations

### Exact vs Flexible Matching

The module implements multiple matching strategies:

- **Exact Matching**: Requires normalized track titles to match exactly
- **Classical Music Matching**: Special handling for classical compositions with key signatures
- **Flexible Matching**: Falls back to substring matching when exact matches aren't found
- **Artist Collaboration Handling**: Properly handles multi-artist tracks and collaborations

## Playback Methods

The module supports two playback methods:

1. **Album-based Playback**: Uses `playAlbumTrack` to play tracks in their album context
2. **Direct Track Playback**: Uses `queueSingleTrack` to play tracks directly

Each supports options for "Play Now" or "Add to Queue" functionality.

### Playback Sequence Behavior

The module implements a smart playback strategy:

- The `startPlay` flag tracks whether the current track should start playback or be queued
- For the first successfully found track, `startPlay` is set to `true`, triggering a "Play Now" action
- After the first track is found and played, `startPlay` is set to `false` for all subsequent tracks
- This causes all subsequent tracks to be added to the queue instead of interrupting playback
- Both album-based and direct search methods respect this flag when determining playback actions

The playback action is determined by selecting the appropriate action from Roon's action list:
- When `startPlay` is `true`, the "Play Now" action (typically `actionListLoad.items[0]`) is selected
- When `startPlay` is `false`, the "Add to Queue" action (typically `actionListLoad.items[2]`) is selected

## Error Handling and Logging

The module implements comprehensive error handling with detailed logging:

- Each step of the search process is logged for debugging
- All API calls are wrapped in try/catch blocks
- Failed tracks are collected and returned for potential retry or reporting
- Normalized values are logged to help debug matching issues

### Unmatched Tracks Handling

Tracks that cannot be found through either search method are:

1. Logged with an error message for debugging
2. Added to an `unmatchedTracks` array
3. Returned at the end of the operation
4. Displayed to the user so they're aware which tracks couldn't be found

This provides transparency to users when certain tracks can't be located in their Roon library.

## Key Functions

- `findTracksInRoon`: Main entry point for track search and playback
- `findTrackByAlbum`: Album-based search strategy
- `findTrackInSearchResults`: Direct search strategy
- `normalizeString`: Normalize strings for comparison
- `normalizeArtistName`: Special handling for artist name normalization
- `playAlbumTrack`: Album-specific track playback
- `queueSingleTrack`: Direct track playback

## Usage Example

```typescript
import { findTracksInRoon } from './client-tracks-manager';
import { RoonApiBrowseOptions } from '@model';

// Track data from user request
const tracks = [
  { artist: "The Beatles", track: "Hey Jude", album: "1 (2015 Version)" },
  { artist: "Queen", track: "Bohemian Rhapsody", album: "A Night at the Opera" },
  { artist: "Unknown Artist", track: "Obscure Song", album: "Rare Album" }
];

// Roon API browse options with zone ID
const browseOptions: RoonApiBrowseOptions = {
  zone_or_output_id: "1a2b3c4d5e6f",
  multi_session_key: "session-123"
};

// Find and play tracks - first track will be played immediately,
// subsequent tracks will be queued
const unmatchedTracks = await findTracksInRoon(tracks, browseOptions);

// Display unmatched tracks to the user
if (unmatchedTracks.length > 0) {
  console.log("The following tracks couldn't be found in your Roon library:");
  unmatchedTracks.forEach(track => {
    console.log(`- "${track.track}" by ${track.artist}`);
  });
}
``` 