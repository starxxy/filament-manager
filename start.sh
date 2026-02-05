#!/bin/bash

# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Configuration
# Try to find embedded node, otherwise use system node
if [ -f "$SCRIPT_DIR/node/bin/node" ]; then
    NODE_PATH="$SCRIPT_DIR/node/bin/node"
else
    NODE_PATH="node"
fi

SERVER_SCRIPT="server.js"
SERVER_LOG="server_local.log"

# FRPC Configuration (Optional, checks local dir first, then hardcoded fallback or skip)
if [ -f "$SCRIPT_DIR/frpc" ]; then
    FRPC_PATH="$SCRIPT_DIR/frpc"
    FRPC_CONFIG="$SCRIPT_DIR/frpc.toml"
elif [ -f "/home/ununtu/frpc" ]; then
    FRPC_PATH="/home/ununtu/frpc"
    FRPC_CONFIG="/home/ununtu/frpc.toml"
else
    FRPC_PATH=""
fi
FRPC_LOG="frpc.log"

check_process() {
    pgrep -u "$USER" -f "$1" > /dev/null
}

start_services() {
    echo "Starting Filament Manager Services..."

    # Start Node.js Server
    echo "Starting Node.js server..."
    # Check if node is available
    if ! command -v "$NODE_PATH" &> /dev/null && [ ! -x "$NODE_PATH" ]; then
        echo "Error: Node.js not found. Please install Node.js or ensure the 'node' binary is in ./node/bin/"
        exit 1
    fi

    if check_process "$SERVER_SCRIPT"; then
        echo "Node.js server is already running."
    else
        # Start supervisor loop to auto-restart on exit
        nohup ./monitor.sh > /dev/null 2>&1 &
        
        sleep 2
        if check_process "$SERVER_SCRIPT"; then
             echo "Node.js server started successfully (supervisor mode)."
        else
             echo "Failed to start Node.js server. Check $SERVER_LOG"
        fi
    fi

    # Start frpc (only if path is set)
    if [ -n "$FRPC_PATH" ] && [ -x "$FRPC_PATH" ]; then
        if check_process "$FRPC_PATH -c $FRPC_CONFIG"; then
            echo "frpc is already running."
        else
            echo "Starting frpc..."
            nohup "$FRPC_PATH" -c "$FRPC_CONFIG" > "$FRPC_LOG" 2>&1 &
            sleep 1
            if check_process "$FRPC_PATH -c $FRPC_CONFIG"; then
                 echo "frpc started successfully."
            else
                 echo "Failed to start frpc. Check $FRPC_LOG"
            fi
        fi
    else
        echo "frpc executable not found or not executable. Skipping frpc start."
    fi
}

stop_services() {
    echo "Stopping services..."
    pkill -f "monitor.sh"
    pkill -f "$SERVER_SCRIPT"
    if [ -n "$FRPC_PATH" ]; then
        pkill -f "$FRPC_PATH"
    fi
    echo "Services stopped."
}

restart_services() {
    stop_services
    sleep 2
    start_services
}

case "$1" in
    start)
        start_services
        ;;
    stop)
        stop_services
        ;;
    restart)
        restart_services
        ;;
    *)
        echo "Usage: $0 {start|stop|restart}"
        exit 1
        ;;
esac
