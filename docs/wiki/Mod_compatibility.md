# Mod compatibility

> Snapshot of [`jesec/ck3-modding-wiki`](https://github.com/jesec/ck3-modding-wiki) `wiki_pages/Mod_compatibility.md`, which mirrors [ck3.paradoxwikis.com](https://ck3.paradoxwikis.com). Licensed CC BY-SA 3.0 (see `LICENSE`). Refresh with `node scripts/sync-wiki.mjs`.

Mod compatibility is the measure of how well different mods work together. Maximising compatibility is done with simple practices that should be followed whenever possible, advanced techniques where necessary, and finally a compatibility patch where there's no other solution.

- [General practices](#general-practices)
  - [Total conversions](#total-conversions)
- [Basic techniques](#basic-techniques)
  - [Shared variable](#shared-variable)
  - [Shared scripted effect](#shared-scripted-effect)
- [Detecting other mods](#detecting-other-mods)
  - [Global variable](#global-variable)
  - [Scripted trigger](#scripted-trigger)

## General practices

Mods may add their own things or alter/replace/remove things that are in vanilla. Any such edit is called an override, as you are replacing the vanilla definition with your own. Files or entities may be overridden (the rules are explained in greater detail [here](https://ck3.paradoxwikis.com/Modding#override_rules)). The vanilla files or entities that a mod overrides is collectively called that mod's *footprint*.

In general, mods are compatible if their footprints do not overlap. That is, the two mods do not override the same vanilla files or entities. Certain mods will advertise which files they override on their Steam page; other mod developers can use this to see compatibility at a glance, and mod users use this information too. *CrusaderKhan120's Rally Point Overhaul* and *DukeOfFluff's Three Hundred Additional Dog Breeds* are expected to be compatible as they deal with wildly different things, but if either or both are particularly poorly written, they may share an on_action structure and be incompatible. So when developing your own mod, always minimise your footprint to the smallest it can practically be.

### Total conversions

Total conversions are the exceptions to this, because they do vanilla *removals*. A mod called *Sedevacantist4Life's Crusading Improvements* could override no vanilla entities at all, having a footprint of zero, and it would still be incompatible with a *Shrek Total Conversion*, if it references Christian faiths in its own events. That is, it checks whether someone is eligible for a flavour event with a trigger like ``faith = faith:catholic``. The Shrek TC has removed Catholicism, and so the crusader mod will check for something that does not exist. That causes errors and erroneous behaviour.

Being TC-compatible is a greater challenge than general compatibility, as it means you must avoid mentioning any database entities in your mod, that is, any references of specific faiths, cultures, characters, titles, and so on. That sacrifices the ability to have any systems or flavour specific to those things, and so it is a perfectly valid choice not to go on that path for your mod.

## Basic techniques

Avoiding footprint overlap is the simplest way to have compatibility, but what if you want two mods to work together, to synergise, but still function independently as well? The two mods can leverage footprint overlaps to make this work.

### Shared variable

This is a very basic technique for mod interoperability. *Lancel0tXGuin3vere's Extra Romantic Romance Events* (ERRE) adds extra content to the seduction scheme, and *4everHoldUrPeace's Marriage Vows Expanded* (MVE) makes weddings more special. If the second mod wants to add marriage vows specific to characters who seduced one another, then it can do so easily by checking for a Character Memory. However, the romance mod may have added different memories, and MVE cannot simply check for those types as they won't exist if ERRE is never loaded. Checking for a non-existent link can, as with the TC case, cause broken behaviour.

The solution is to make the interaction point be something you can check without knowing whether it could exist. That something is a named variable. The ERRE can decide to store a variable on each character, called ``var:erre_seduced_each_other``, and it can be given a value of ``flag:seduced_in_woods`` for more specificity. Then MVE can simply check ``has_variable = erre_seduced_each_other`` and it will return true if the variable exists (it has been set by ERRE), and false otherwise. This script does not depend on either mod being loaded, but when they are loaded together, they synergise.

### Shared scripted effect

Let's say ERRE from the previous example wants to add a shotgun wedding as part of seduction, and MVE, which already has a shotgun wedding event of its own, wants that used instead (or a modified version). A shared variable won't do you any good as here timing is important, you want ERRE to fire up MVE content; but still you want ERRE to fire up its own content when MVE is not loaded, and likewise want MVE to not depend on ERRE for its regular wedding content.

The solution is a shared scripted effect, but with special care for file names. ERRE must do the following.

**1. Extract the firing of the shotgun wedding event to a scripted effect.** That is, in the calling logic, write this:
```
erre_fire_shotgun_wedding_effect = yes
```

And in the effect:
```
erre_fire_shotgun_wedding_effect = {
    trigger_event = erre_shotgun_wedding.1
}
```

This may seem redundant at first, but it is essential to extract this step in the process.

**2. Save that effect in a file, whose name starts with a number or a low letter in the alphabet**, for example ``aaa_erre_shotgun_wedding_effect.txt``

Then MVE must do the following:

**1. Write its own version of the shotgun wedding effect that fires MVE content**, for example:
```
erre_fire_shotgun_wedding_effect = {
    trigger_event = mve_erre_compatibility_shotgun_wedding.1
}
```

**2. Save that effect in a file whose name starts with a late letter in the alphabet**, for example ``zzz_mve_shotgun_wedding_effect.txt``.

Now the two mods are compatible. Here's what will happen:
- If ERRE is loaded but MVE is not, then ERRE will fire *its* definition of ``erre_fire_shotgun_wedding_effect``, which will fire its own event.
- If MVE is loaded but ERRE is not, then ``erre_fire_shotgun_wedding_effect`` never fires, as MVE does not call it.
- If ERRE and MVE are both loaded, then ERRE will fire ``erre_fire_shotgun_wedding_effect`` but MVE's definition will get executed. That is because MVE defines the same entity in a file that is later in the alphabet, thus it overrides the former definition.

This basic idea applies to lots of different entity types, and it works regardless of the loading order between those mods, as the loading of different files is done in alphabetical order. You can have shared scripted triggers, scripted effects, scripted modifiers, and so on. What matters is that it is an entity that can be loaded and overridden on an entity basis. As such it does not work for events, hence the need to pipe the calling through a scripted effect.

## Detecting other mods

Sometimes you just need to know that a specific mod is active. For example, if *IAcedIELTS's Language Learning Overhaul* (LLO) is TC-compatible mod, but it does want to use different flavour text related to the Farquaad dialect if the Shrek Total Conversion is active. Shrek, the mod that needs to be detected, can do a few things to announce itself; putting up more signs around one's swamp, but also define either a scripted trigger or a global variable (or both).

### Global variable

The global variable works like the shared variable example, with the difference that the variable here lives in the global space, and as such it can be triggered for from anywhere.

The Shrek TC simply writes the following in any on_action file:
```
on_game_start = { on_actions = { shrek_compatibility_on_game_start } }
shrek_compatibility_on_game_start = {
    effect = {
        set_global_variable = { name = shrek_is_loaded value = yes }
    }
}
```

The first line ensures that this on_action does not override the effect block of vanilla's on_game_start, this is a common mistake. Then LLO can use ``has_global_variable = shrek_is_loaded`` as its universal check for whether we are in Far Far Away or not.

Two things to keep in mind:
- This will only reliably set the variable *after* on_game_start has passed. Simply, there's no guarantee that when two mods use on_game_start, one can fire something before or after the other.
- This will only work if the game is first begun with the Shrek mod active. That's expected for a TC but for other mods, if they are activated midway through a campaign, the variable will not be set.

### Scripted trigger

The scripted trigger works like the example we just discussed. The Shrek Total Conversion needs to declare a scripted trigger like this:
```
shrek_is_loaded = {
    always = yes
}
```

It will of course be always true because it is the Shrek mod *defining* this trigger; when this scripted trigger is loaded, it is loaded. It finally needs to store that scripted trigger *late* in the alphabet, under a file like ``zzz_shrek_compatibility_triggers.txt``.

LLO, a mod that wants to know if Shrek is around, needs to define its own version of ``shrek_is_loaded``:
```
shrek_is_loaded = {
    always = no
}
```

It is initialised as ``always = no`` because there is no Shrek mod by default, it is an opt-in. But if LLO ensures to save this as a file *early* in the alphabet, for example ``aaa_llo_shrek_compatibility_triggers.txt``, then *if* Shrek is loaded, it will override the scripted trigger. That way, LLO can simply check ``shrek_is_loaded = yes`` in its events and it will work appropriately.

Category:Modding

---

*Source: https://ck3.paradoxwikis.com/Mod_compatibility*
