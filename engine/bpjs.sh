#!/bin/bash
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
UBERJAR=$SCRIPT_DIR/BPjs-0.12.4-SNAPSHOT.uber.jar
if [ ! -f $UBERJAR ]; then
    echo Missing jar file $UBERJAR in the target directory
    exit -2
fi

java -jar $UBERJAR $*

