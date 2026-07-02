// The following are the default window level presets and can be further
// configured via the customization service.
//
// CT presets use calibrated Hounsfield units. MR presets are NON-calibrated
// convenience starting points only: MR pixel intensities are scanner- and
// sequence-dependent (no standard unit like HU), so a radiologist is expected
// to adjust from these. They exist so an MRI does not open with only the value
// baked in by the console. (BlackVoxel imaging_interop_01 / MIMPS-48.)
const defaultWindowLevelPresets = {
  CT: [
    { id: 'ct-soft-tissue', description: 'Soft tissue', window: '400', level: '40' },
    { id: 'ct-lung', description: 'Lung', window: '1500', level: '-600' },
    { id: 'ct-liver', description: 'Liver', window: '150', level: '90' },
    { id: 'ct-bone', description: 'Bone', window: '2500', level: '480' },
    { id: 'ct-brain', description: 'Brain', window: '80', level: '40' },
  ],

  // Non-calibrated starting points (see note above) — adjust per sequence.
  MR: [
    { id: 'mr-default', description: 'Default', window: '1000', level: '500' },
    { id: 'mr-brain-t1', description: 'Brain T1', window: '500', level: '250' },
    { id: 'mr-brain-t2', description: 'Brain T2', window: '1000', level: '500' },
    { id: 'mr-spine', description: 'Spine', window: '800', level: '400' },
    { id: 'mr-soft-tissue', description: 'Soft tissue', window: '600', level: '300' },
  ],

  PT: [
    { id: 'pt-default', description: 'Default', window: '5', level: '2.5' },
    { id: 'pt-suv-3', description: 'SUV', window: '0', level: '3' },
    { id: 'pt-suv-5', description: 'SUV', window: '0', level: '5' },
    { id: 'pt-suv-7', description: 'SUV', window: '0', level: '7' },
    { id: 'pt-suv-8', description: 'SUV', window: '0', level: '8' },
    { id: 'pt-suv-10', description: 'SUV', window: '0', level: '10' },
    { id: 'pt-suv-15', description: 'SUV', window: '0', level: '15' },
  ],
};

export default defaultWindowLevelPresets;
