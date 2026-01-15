# Changelog

## [5.0.3-beta](https://github.com/equinor/videx-3d/compare/v5.0.2-beta...v5.0.3-beta) (2026-01-06)


### Bug Fixes

* **7143:** add npm as engine ([#111](https://github.com/equinor/videx-3d/issues/111)) ([49fac82](https://github.com/equinor/videx-3d/commit/49fac823623840c99e9e1c51c118e90ffed36f3d))
* **github-actions:** bump github/codeql-action from 4.31.4 to 4.31.9 ([#108](https://github.com/equinor/videx-3d/issues/108)) ([233c1b7](https://github.com/equinor/videx-3d/commit/233c1b700e11ad243f961412913bad9cf5b33fa0))

## [5.0.2-beta](https://github.com/equinor/videx-3d/compare/v5.0.1-beta...v5.0.2-beta) (2025-12-18)


### Bug Fixes

* **github-actions:** bump codecov/codecov-action from 5.5.1 to 5.5.2 ([#104](https://github.com/equinor/videx-3d/issues/104)) ([2efd100](https://github.com/equinor/videx-3d/commit/2efd1004461c4b5f2dd00773898ff3c81ba5cc10))
### Improvements
* Further optimizations and improvements to annotation depth testing and emitter GPU picking.

## [5.0.1-beta](https://github.com/equinor/videx-3d/compare/v5.0.0-beta...v5.0.1-beta) (2025-12-09)


### Bug Fixes

* **58:** Improved depth reading in EventEmitter. Fixes [#58](https://github.com/equinor/videx-3d/issues/58) ([#95](https://github.com/equinor/videx-3d/issues/95)) ([49950b7](https://github.com/equinor/videx-3d/commit/49950b7cf67f70e22108c0c8221b751499d148c3))

## [5.0.0-beta](https://github.com/equinor/videx-3d/compare/v4.3.1-beta...v5.0.0-beta) (2025-12-03)


### ⚠ BREAKING CHANGES

* changed event emitter logic to make thin/small objects easier to select among larger objects ([#92](https://github.com/equinor/videx-3d/issues/92))

### Bug Fixes

* changed event emitter logic to make thin/small objects easier to select among larger objects ([#92](https://github.com/equinor/videx-3d/issues/92)) ([5a94357](https://github.com/equinor/videx-3d/commit/5a94357540c634de9d4695a33cfa5885efcec12e))

## [4.3.1-beta](https://github.com/equinor/videx-3d/compare/v4.3.0-beta...v4.3.1-beta) (2025-11-26)


### Bug Fixes

* Corrected surface geometry transformations and transformed uv coordinates used to look up depth values in surface material ([#89](https://github.com/equinor/videx-3d/issues/89)) ([ca9cfcd](https://github.com/equinor/videx-3d/commit/ca9cfcd05d736aee194dcb3210a03685e48d2925))

## [4.3.0-beta](https://github.com/equinor/videx-3d/compare/v4.2.1-beta...v4.3.0-beta) (2025-11-25)


### Features

* Added pointer position and camera to event callback data ([#86](https://github.com/equinor/videx-3d/issues/86)) ([d803877](https://github.com/equinor/videx-3d/commit/d803877aa5795ba34a614cc159c8b60d0b9967fe))

## [4.2.1-beta](https://github.com/equinor/videx-3d/compare/v4.2.0-beta...v4.2.1-beta) (2025-11-24)


### Bug Fixes

* Correct ref set to mesh rather than group. Fixes event registration. ([#84](https://github.com/equinor/videx-3d/issues/84)) ([c60da22](https://github.com/equinor/videx-3d/commit/c60da229fc98051d500bb7dd24b1ff3bf57e3499))

## [4.2.0-beta](https://github.com/equinor/videx-3d/compare/v4.1.2-beta...v4.2.0-beta) (2025-11-24)


### Features

* Added onWellboreOver callback option to well map tracks in order to track which wellbore is hovered and at which depth. Will return null for wellbore and undefined depth when no wellbore is currently hovered. ([#82](https://github.com/equinor/videx-3d/issues/82)) ([143d6c1](https://github.com/equinor/videx-3d/commit/143d6c1112b634c613ebe5cf23e4c1ad8a4887e4))

## [4.1.2-beta](https://github.com/equinor/videx-3d/compare/v4.1.1-beta...v4.1.2-beta) (2025-11-18)


### Bug Fixes

* Fixed issue with renderOrder on surfaces and improved the CameraTargetMarker component allowing to specify depthTest and depthWrite as well as providing a custom object as a child component ([#76](https://github.com/equinor/videx-3d/issues/76)) ([d58ed21](https://github.com/equinor/videx-3d/commit/d58ed2130d1d4c67624ad4f2b7d60730ba7173da))

## [4.1.1-beta](https://github.com/equinor/videx-3d/compare/v4.1.0-beta...v4.1.1-beta) (2025-11-18)


### Chore

* only add render order to groups with immediate children and remo… ([#74](https://github.com/equinor/videx-3d/issues/74)) ([bec6a46](https://github.com/equinor/videx-3d/commit/bec6a461081570fabfaba4c4a217646dc1de55e9))

## [4.1.0-beta](https://github.com/equinor/videx-3d/compare/v4.0.0-beta...v4.1.0-beta) (2025-10-29)


### Features

* allow some customization of highligter component ([#68](https://github.com/equinor/videx-3d/issues/68)) ([852db52](https://github.com/equinor/videx-3d/commit/852db52eb092c1d13e59a72af898eb8d0a200c28))
* well map not limited to kickoff depth of root wellbore and allow passing an exclusion list for wellbores not wanted in the well tree ([#66](https://github.com/equinor/videx-3d/issues/66)) ([ee73930](https://github.com/equinor/videx-3d/commit/ee7393091667c890c6c537a689186d855cd2f2e8))

## [4.0.0-beta](https://github.com/equinor/videx-3d/compare/v3.1.0-beta...v4.0.0-beta) (2025-10-22)


### ⚠ BREAKING CHANGES

* Allow passing an AbortSignal to the GeneratorRegistryProvider … ([#63](https://github.com/equinor/videx-3d/issues/63))

### Features

* Allow passing an AbortSignal to the GeneratorRegistryProvider … ([#63](https://github.com/equinor/videx-3d/issues/63)) ([6d28348](https://github.com/equinor/videx-3d/commit/6d28348ebde087d7eb649345404cae3b5f502f45))

## [3.1.0-beta](https://github.com/equinor/videx-3d/compare/v3.0.3-beta...v3.1.0-beta) (2025-10-14)


### Features

* allow CRS instance to be used as input as an alternative to UTM zone ([#56](https://github.com/equinor/videx-3d/issues/56)) ([3a25959](https://github.com/equinor/videx-3d/commit/3a259593639890d234ebda94f14511f7da9450bf))

## [3.0.3-beta](https://github.com/equinor/videx-3d/compare/v3.0.2-beta...v3.0.3-beta) (2025-10-10)


### Bug Fixes

* **48:** Revert trying to reuse annotations root, but leave fix for q… ([db0f832](https://github.com/equinor/videx-3d/commit/db0f83220b095f1b1f56758d77e2c397b9e4443a))
* **48:** Revert trying to reuse annotations root, but leave fix for query selector ([00285d5](https://github.com/equinor/videx-3d/commit/00285d558fe81c86e0f67d2a91b6d595e857dd2e))

## [3.0.2-beta](https://github.com/equinor/videx-3d/compare/v3.0.1-beta...v3.0.2-beta) (2025-10-10)


### Bug Fixes

* **48:** re-use existing container if present and fix query selector ([7e401e8](https://github.com/equinor/videx-3d/commit/7e401e8416b06636a947c84cbf2e2c2a8091b4e2))
* **48:** re-use existing container if present and fix query selector ([b188050](https://github.com/equinor/videx-3d/commit/b188050cb2bb932bb06c936601fe61c025b002ef))

## [3.0.1-beta](https://github.com/equinor/videx-3d/compare/v3.0.0-beta...v3.0.1-beta) (2025-10-08)


### Bug Fixes

* **48:** remove existing  annotations container before creating new one ([#49](https://github.com/equinor/videx-3d/issues/49)) ([5119c5b](https://github.com/equinor/videx-3d/commit/5119c5b02ad663f0b1393e75112945bed097f279))

## [3.0.0-beta](https://github.com/equinor/videx-3d/compare/v2.1.1-beta...v3.0.0-beta) (2025-09-12)


### ⚠ BREAKING CHANGES

* Renamed Picks component to FormationMarkers ([#44](https://github.com/equinor/videx-3d/issues/44))

### Miscellaneous Chores

* Renamed Picks component to FormationMarkers ([#44](https://github.com/equinor/videx-3d/issues/44)) ([6bcc68c](https://github.com/equinor/videx-3d/commit/6bcc68c4f5e2472b303ba97e3650d02560349d81))

## [2.1.1-beta](https://github.com/equinor/videx-3d/compare/v2.1.0-beta...v2.1.1-beta) (2025-09-02)


### Bug Fixes

* add id-token write permission to workflow ([fc003b7](https://github.com/equinor/videx-3d/commit/fc003b76431fca5e3d99a4248dd70f3f191f980b))
* add id-token write permission to workflow ([89f58d3](https://github.com/equinor/videx-3d/commit/89f58d342fcfc1f153ea240ab2f343662a714d7f))

## [2.1.0-beta](https://github.com/equinor/videx-3d/compare/v2.0.0-beta...v2.1.0-beta) (2025-09-02)


### Features

* add publish step to release.yml ([3c5d807](https://github.com/equinor/videx-3d/commit/3c5d8071c798d26df7e3656f132933df2d3cad48))
* add publish step to release.yml ([ee75acc](https://github.com/equinor/videx-3d/commit/ee75acc460dc545413c3a908d6e5d93738ddc8ca))

## [2.0.0-beta](https://github.com/equinor/videx-3d/compare/v1.0.0-beta...v2.0.0-beta) (2025-08-28)


### ⚠ BREAKING CHANGES

* formations

### Features

* added initial support for rendering text/glyphs in fragment shader ([#15](https://github.com/equinor/videx-3d/issues/15)) ([5224166](https://github.com/equinor/videx-3d/commit/5224166d9eccc3d176d19ab85783e16acf5a6556))
* formations ([0248bf5](https://github.com/equinor/videx-3d/commit/0248bf52ad5cceb4475caf79ac45b8be19a712f4))
* improved curve sampling for optimized and consistant wellbore geometries ([2dec08b](https://github.com/equinor/videx-3d/commit/2dec08be024f89c80d01782c6ad8bbf50a51c593))


### Bug Fixes

* **doc:** Fixed a mistake in getting-started ([82571f8](https://github.com/equinor/videx-3d/commit/82571f8af887a6fedae953810af4bbf6231f5d98))
* **docs:** Incorrect link fixed ([e1d5d26](https://github.com/equinor/videx-3d/commit/e1d5d26384efde3eb39c1d635601b41870e1dfbc))
* **docs:** make links to documents from comments work in GH Pages ([41ba7ba](https://github.com/equinor/videx-3d/commit/41ba7ba8fd251193cb8fc40e5c05b2a5b99ca14d))
* fixed an issue with BoxGrid axes offset and set default gridScale to [1, 1, 1] ([384e6eb](https://github.com/equinor/videx-3d/commit/384e6ebbe88df5af4d430b5c985a10e7af8222c5))
* made links grom getting-started absolute ([0932011](https://github.com/equinor/videx-3d/commit/093201118edaeeda6029c9e9352e735a9dff88f3))
* simplified and fixed picks selection logic ([#17](https://github.com/equinor/videx-3d/issues/17)) ([fd02cf0](https://github.com/equinor/videx-3d/commit/fd02cf085136b09a0b2121c3ac3cf39cb80f429a))
* typedoc issue with generating diff sections from md files. Linking to the md directly from the readme instead of including it in the github pages ([8c8d639](https://github.com/equinor/videx-3d/commit/8c8d639111caedf1e58d8b42b966cd1e5e83baab))
* use glyph provider in sdfTest component and fix parameter qualifiers in glyph shaders ([#18](https://github.com/equinor/videx-3d/issues/18)) ([0338924](https://github.com/equinor/videx-3d/commit/0338924ef53c4ee93589ca94375ef7f6ca823b83))

## [1.0.0-beta](https://github.com/equinor/videx-3d/compare/v0.3.0-beta...v1.0.0-beta) (2025-08-20)


### ⚠ BREAKING CHANGES

* formations

### Features

* added initial support for rendering text/glyphs in fragment shader ([#15](https://github.com/equinor/videx-3d/issues/15)) ([5224166](https://github.com/equinor/videx-3d/commit/5224166d9eccc3d176d19ab85783e16acf5a6556))
* formations ([0248bf5](https://github.com/equinor/videx-3d/commit/0248bf52ad5cceb4475caf79ac45b8be19a712f4))
* improved curve sampling for optimized and consistant wellbore geometries ([2dec08b](https://github.com/equinor/videx-3d/commit/2dec08be024f89c80d01782c6ad8bbf50a51c593))


### Bug Fixes

* **doc:** Fixed a mistake in getting-started ([82571f8](https://github.com/equinor/videx-3d/commit/82571f8af887a6fedae953810af4bbf6231f5d98))
* **docs:** Incorrect link fixed ([e1d5d26](https://github.com/equinor/videx-3d/commit/e1d5d26384efde3eb39c1d635601b41870e1dfbc))
* **docs:** make links to documents from comments work in GH Pages ([41ba7ba](https://github.com/equinor/videx-3d/commit/41ba7ba8fd251193cb8fc40e5c05b2a5b99ca14d))
* fixed an issue with BoxGrid axes offset and set default gridScale to [1, 1, 1] ([384e6eb](https://github.com/equinor/videx-3d/commit/384e6ebbe88df5af4d430b5c985a10e7af8222c5))
* made links grom getting-started absolute ([0932011](https://github.com/equinor/videx-3d/commit/093201118edaeeda6029c9e9352e735a9dff88f3))
* simplified and fixed picks selection logic ([#17](https://github.com/equinor/videx-3d/issues/17)) ([fd02cf0](https://github.com/equinor/videx-3d/commit/fd02cf085136b09a0b2121c3ac3cf39cb80f429a))
* typedoc issue with generating diff sections from md files. Linking to the md directly from the readme instead of including it in the github pages ([8c8d639](https://github.com/equinor/videx-3d/commit/8c8d639111caedf1e58d8b42b966cd1e5e83baab))
* use glyph provider in sdfTest component and fix parameter qualifiers in glyph shaders ([#18](https://github.com/equinor/videx-3d/issues/18)) ([0338924](https://github.com/equinor/videx-3d/commit/0338924ef53c4ee93589ca94375ef7f6ca823b83))

## [0.3.0-beta](https://github.com/equinor/videx-3d/compare/0.2.0-beta...v0.3.0-beta) (2025-08-19)


### Features

* added initial support for rendering text/glyphs in fragment shader ([#15](https://github.com/equinor/videx-3d/issues/15)) ([5224166](https://github.com/equinor/videx-3d/commit/5224166d9eccc3d176d19ab85783e16acf5a6556))
* improved curve sampling for optimized and consistant wellbore geometries ([2dec08b](https://github.com/equinor/videx-3d/commit/2dec08be024f89c80d01782c6ad8bbf50a51c593))


### Bug Fixes

* simplified and fixed picks selection logic ([#17](https://github.com/equinor/videx-3d/issues/17)) ([fd02cf0](https://github.com/equinor/videx-3d/commit/fd02cf085136b09a0b2121c3ac3cf39cb80f429a))
* use glyph provider in sdfTest component and fix parameter qualifiers in glyph shaders ([#18](https://github.com/equinor/videx-3d/issues/18)) ([0338924](https://github.com/equinor/videx-3d/commit/0338924ef53c4ee93589ca94375ef7f6ca823b83))
