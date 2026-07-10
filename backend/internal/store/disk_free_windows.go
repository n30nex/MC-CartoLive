//go:build windows

package store

import (
	"path/filepath"

	"golang.org/x/sys/windows"
)

func filesystemSpace(path string) (StorageInfo, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return StorageInfo{}, err
	}
	pathPtr, err := windows.UTF16PtrFromString(abs)
	if err != nil {
		return StorageInfo{}, err
	}
	var available uint64
	var total uint64
	var free uint64
	if err := windows.GetDiskFreeSpaceEx(pathPtr, &available, &total, &free); err != nil {
		return StorageInfo{}, err
	}
	return StorageInfo{TotalBytes: total, FreeBytes: available}, nil
}
