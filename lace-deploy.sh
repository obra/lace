#!/bin/bash

# Restricted SSH wrapper for Lace auto-update deployment
# Only allows rsync to the lace distribution directory

case "$SSH_ORIGINAL_COMMAND" in
  'rsync --server'*)
    # Allow rsync server commands to lace directory only
    if [[ "$SSH_ORIGINAL_COMMAND" == *"/opt/web/hosted/www.fsck.com/html/lace/dist/"* ]]; then
      exec $SSH_ORIGINAL_COMMAND
    else
      echo "Access denied: rsync path not allowed ($SSH_ORIGINAL_COMMAND)"
      exit 1
    fi
    ;;
  *)
    echo "Access denied: only rsync commands allowed ($SSH_ORIGINAL_COMMAND)"
    exit 1
    ;;
esac