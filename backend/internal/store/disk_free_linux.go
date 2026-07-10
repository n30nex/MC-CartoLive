//go:build linux

package store

import "syscall"

func filesystemSpace(path string) (StorageInfo, error) {
	var stat syscall.Statfs_t
	if err := syscall.Statfs(path, &stat); err != nil {
		return StorageInfo{}, err
	}
	return StorageInfo{
		TotalBytes: stat.Blocks * uint64(stat.Bsize),
		FreeBytes:  stat.Bavail * uint64(stat.Bsize),
	}, nil
}
