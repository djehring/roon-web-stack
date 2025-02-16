# Using the Roon API to Search for and Queue Tracks

This document outlines the process of using the Roon API's `RoonApiBrowse` service to search for and queue tracks. It details the complete workflow from search to playback.

## Overview

The `RoonApiBrowse` interface provides a sophisticated hierarchy-based navigation system for interacting with Roon. The process involves:

1. Session management
2. Search and navigation
3. Result filtering
4. Track queueing and playback control

## Detailed Process

### 1. Session Management

Each browse session requires initialization and proper state management:

```typescript
const resetOptions = { 
  hierarchy: "search", 
  refresh_list: true, 
  multi_session_key: clientId 
};
await roon.browse(resetOptions);
```

### 2. Search Process

The search involves multiple steps:

```typescript
// Perform initial search
const searchOptions = {
  hierarchy: "search",
  input: `${artistName} ${trackName}`,
  pop_all: true,
  multi_session_key: clientId
};
const searchResponse = await roon.browse(searchOptions);

// Load search results
const loadResponse = await roon.load({
  hierarchy: "search",
  offset: 0,
  count: 5,
  multi_session_key: clientId
});
```

### 3. Navigating Results

Results are organized hierarchically:

1. First, locate the "Tracks" section
2. Navigate into the tracks list
3. Load the track items
4. Match desired track using case-insensitive comparison

```typescript
// Find and navigate to Tracks section
const tracksItem = loadResponse.items.find(item => item.title === "Tracks");
if (tracksItem) {
  await roon.browse({
    hierarchy: "search",
    item_key: tracksItem.item_key,
    multi_session_key: clientId
  });
}
```

### 4. Track Queueing

Queueing involves handling different action types:

```typescript
// Queue or play track
if (queueItem.hint === "action_list") {
  // Handle action list (multiple options)
  // First item typically plays, third typically queues
} else if (queueItem.hint === "action") {
  // Direct action execution
}
```

## Error Handling

Implement comprehensive error handling:

1. Session reset failures
2. Search failures
3. Navigation errors
4. Queueing issues

Example:
```typescript
try {
  // Perform operations
} catch (error) {
  logger.error(`Error processing track: ${JSON.stringify(error)}`);
  // Handle error appropriately
}
```

## Best Practices

1. **Session Management**
   - Reset browse session before new searches
   - Maintain session key consistency

2. **Search Optimization**
   - Use both artist and track name in search
   - Implement case-insensitive matching
   - Handle partial matches appropriately

3. **Queue Management**
   - First track: Play immediately
   - Subsequent tracks: Add to queue
   - Handle different action types (action_list vs action)

4. **Error Handling**
   - Implement comprehensive error catching
   - Log errors with relevant context
   - Track unmatched or failed items

## Conclusion

This implementation provides a robust solution for track search and queueing in Roon, handling the complexities of the browse hierarchy and various response types while maintaining reliable playback control.