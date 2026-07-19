/* OpenReplay session-replay loader — build-time placeholder that records
   nothing. At container start, docker/30-openreplay.sh overwrites this file
   with a live loader when OPENREPLAY_PROJECT_KEY is set; without the key the
   image ships no analytics. */
