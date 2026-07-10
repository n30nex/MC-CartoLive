//go:build !linux && !windows

package store

import "errors"

func filesystemSpace(string) (StorageInfo, error) {
	return StorageInfo{}, errors.New("filesystem space inspection unsupported on this platform")
}
