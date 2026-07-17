import * as React from 'react';

function LuaModsLoadOrderInfo() {
    return (
        <div className='panel panel-default etb-luamods-info'>
            <div className='panel-heading etb-luamods-info-header'>Lua Mods</div>
            <div className='panel-body'>
                <p>
                    Enable or disable the Lua script mods installed to
                    {' '}<code>EscapeTheBackrooms\Binaries\Win64\ue4ss\Mods</code>.
                </p>
                <p>
                    Lua mods inject changes into the game without a PAK file. A mod loader
                    {' '}(<a href='https://github.com/ETBCommunity/UE4SS/releases/latest'>ETB UE4SS</a>)
                    {' '}must be installed for these mods to load.
                </p>
                <p className='etb-luamods-info-note'>
                    Changes here are written to the game's <code>mods.txt</code> and apply the next
                    time the game launches.
                </p>
            </div>
        </div>
    );
}

export default LuaModsLoadOrderInfo;
